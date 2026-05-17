package watch

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const maxWebSocketMessageSize = 1 << 20

var watchWebSocketClients atomic.Int64

var watchEvents = struct {
	sync.Mutex
	nextID      int64
	subscribers map[int64]*EventQueue
}{
	subscribers: map[int64]*EventQueue{},
}

func WatchWebSocketClientCount() int {
	return int(watchWebSocketClients.Load())
}

func BroadcastWatchEvent(event Event) {
	watchEvents.Lock()
	defer watchEvents.Unlock()
	for _, eq := range watchEvents.subscribers {
		eq.Push(event)
	}
}

func SubscribeWatchEvents() (<-chan Event, func()) {
	eq := NewEventQueue()
	watchEvents.Lock()
	watchEvents.nextID++
	id := watchEvents.nextID
	watchEvents.subscribers[id] = eq
	watchEvents.Unlock()
	return eq.Out(), func() {
		watchEvents.Lock()
		delete(watchEvents.subscribers, id)
		watchEvents.Unlock()
		eq.Close()
	}
}

func (h *Handler) watchWebSocket(w http.ResponseWriter, r *http.Request) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		writeError(w, http.StatusBadRequest, "websocket upgrade required")
		return
	}
	conn, rw, err := upgradeWebSocket(w, r)
	if err != nil {
		return
	}
	clients := watchWebSocketClients.Add(1)
	defer func() { _ = conn.Close() }()
	defer watchWebSocketClients.Add(-1)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	controlEvents := NewEventQueue()
	defer controlEvents.Close()
	go h.watchWebSocketReads(ctx, conn, rw, controlEvents, cancel)
	runtimeEvents, unsubscribe := SubscribeWatchEvents()
	defer unsubscribe()
	controlEventCh := controlEvents.Out()

	if err := writeWebSocketJSON(rw, Event{Type: "watch.connected", At: nowString(), Data: map[string]int64{"clients": clients}}); err != nil {
		return
	}

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	pingTicker := time.NewTicker(20 * time.Second)
	defer pingTicker.Stop()
	var lastRepresentationHash string
	var lastVersionID int64
	for {
		lock, live, err := h.Store.ActiveLiveLock(ctx, LockHeartbeatTimeout)
		if err != nil {
			_ = writeWebSocketJSON(rw, Event{Type: "watch.error", At: nowString(), Message: err.Error()})
			return
		}
		if live && lock.Status == "stopping" {
			_ = writeWebSocketJSON(rw, Event{Type: "lock.disabled", RepositoryID: lock.RepositoryID, At: nowString(), Data: lock})
			_ = writeWebSocketJSON(rw, Event{Type: "watch.stopped", RepositoryID: lock.RepositoryID, At: nowString(), Data: lock})
			return
		}
		eventType := "watch.stopped"
		if live {
			eventType = "watch.heartbeat"
			if lock.Status == "paused" {
				eventType = "watch.paused"
			}
		}
		if err := writeWebSocketJSON(rw, Event{Type: eventType, RepositoryID: lock.RepositoryID, At: nowString(), Data: lock}); err != nil {
			return
		}
		if live {
			summary, err := h.Store.RepresentationSummary(ctx, lock.RepositoryID)
			if err == nil && summary.RepresentationHash != "" && summary.RepresentationHash != lastRepresentationHash {
				if lastRepresentationHash != "" {
					if diffs, diffErr := h.Store.BuildWatchDiffs(ctx, lock.RepositoryID, summary.RepresentationHash); diffErr == nil {
						summary.Diffs = diffs
					}
				}
				lastRepresentationHash = summary.RepresentationHash
				if err := writeWebSocketJSON(rw, Event{Type: "representation.updated", RepositoryID: lock.RepositoryID, At: nowString(), Data: summary}); err != nil {
					return
				}
			}
			version, found, err := h.Store.LatestWatchVersion(ctx, lock.RepositoryID)
			if err == nil && found && version.ID != lastVersionID {
				lastVersionID = version.ID
				if err := writeWebSocketJSON(rw, Event{Type: "version.created", RepositoryID: lock.RepositoryID, At: nowString(), Data: version}); err != nil {
					return
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case event, ok := <-controlEventCh:
			if !ok {
				controlEventCh = nil
				goto next
			}
			for {
				if err := writeWebSocketJSON(rw, event); err != nil {
					return
				}
				if event.Type == "watch.stopped" {
					return
				}
				select {
				case <-ctx.Done():
					return
				case event, ok = <-controlEventCh:
					if !ok {
						controlEventCh = nil
						goto next
					}
				default:
					goto next
				}
			}
		case event, ok := <-runtimeEvents:
			if !ok {
				runtimeEvents = nil
				goto next
			}
			for {
				if err := writeWebSocketJSON(rw, event); err != nil {
					return
				}
				if event.Type == "watch.stopped" {
					return
				}
				select {
				case <-ctx.Done():
					return
				case event, ok = <-runtimeEvents:
					if !ok {
						runtimeEvents = nil
						goto next
					}
				default:
					goto next
				}
			}
		case <-pingTicker.C:
			if err := writeWebSocketPing(rw); err != nil {
				return
			}
		case <-ticker.C:
		}
	next:
	}
}

func (h *Handler) watchWebSocketReads(ctx context.Context, conn net.Conn, reader io.Reader, controlEvents *EventQueue, cancel context.CancelFunc) {
	defer cancel()
	for {
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		msg, err := readWebSocketMessage(reader)
		if err != nil {
			return
		}
		var body struct {
			Type         string `json:"type"`
			RepositoryID int64  `json:"repository_id"`
			RemoteURL    string `json:"remote_url"`
		}
		if err := json.Unmarshal(msg, &body); err != nil {
			continue
		}
		switch body.Type {
		case "watch.pause":
			if body.RepositoryID > 0 {
				_ = h.Store.RequestPause(ctx, body.RepositoryID)
				controlEvents.Push(Event{Type: "watch.paused", RepositoryID: body.RepositoryID, At: nowString()})
			} else {
				lock, live, _ := h.Store.ActiveLiveLock(ctx, LockHeartbeatTimeout)
				_ = h.Store.RequestPauseActive(ctx)
				if live {
					controlEvents.Push(Event{Type: "watch.paused", RepositoryID: lock.RepositoryID, At: nowString(), Data: lock})
				}
			}
		case "watch.resume":
			if body.RepositoryID > 0 {
				_ = h.Store.RequestResume(ctx, body.RepositoryID)
				controlEvents.Push(Event{Type: "watch.heartbeat", RepositoryID: body.RepositoryID, At: nowString()})
			} else {
				lock, live, _ := h.Store.ActiveLiveLock(ctx, LockHeartbeatTimeout)
				_ = h.Store.RequestResumeActive(ctx)
				if live {
					controlEvents.Push(Event{Type: "watch.heartbeat", RepositoryID: lock.RepositoryID, At: nowString(), Data: lock})
				}
			}
		case "watch.stop":
			if body.RepositoryID > 0 {
				_ = h.Store.RequestStop(ctx, body.RepositoryID)
				controlEvents.Push(Event{Type: "lock.disabled", RepositoryID: body.RepositoryID, At: nowString()})
				controlEvents.Push(Event{Type: "watch.stopped", RepositoryID: body.RepositoryID, At: nowString()})
			} else {
				lock, live, _ := h.Store.ActiveLiveLock(ctx, LockHeartbeatTimeout)
				_ = h.Store.RequestStopActive(ctx)
				if live {
					controlEvents.Push(Event{Type: "lock.disabled", RepositoryID: lock.RepositoryID, At: nowString(), Data: lock})
					controlEvents.Push(Event{Type: "watch.stopped", RepositoryID: lock.RepositoryID, At: nowString(), Data: lock})
				} else {
					controlEvents.Push(Event{Type: "watch.stopped", At: nowString()})
				}
			}
		case "watch.reassociateRepo":
			if body.RepositoryID > 0 && strings.TrimSpace(body.RemoteURL) != "" {
				_, _ = h.Store.ReassociateRepository(ctx, body.RepositoryID, body.RemoteURL)
			}
		case "watch.status":
		}
	}
}

func upgradeWebSocket(w http.ResponseWriter, r *http.Request) (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "websocket unsupported", http.StatusInternalServerError)
		return nil, nil, errors.New("hijack unsupported")
	}
	key := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key"))
	if key == "" {
		http.Error(w, "missing Sec-WebSocket-Key", http.StatusBadRequest)
		return nil, nil, errors.New("missing websocket key")
	}
	conn, rw, err := hj.Hijack()
	if err != nil {
		return nil, nil, err
	}
	accept := websocketAccept(key)
	_, err = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n")
	if err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	if err := rw.Flush(); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	return conn, rw, nil
}

func websocketAccept(key string) string {
	sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func writeWebSocketJSON(rw *bufio.ReadWriter, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err := writeWebSocketFrame(rw, data); err != nil {
		return err
	}
	return rw.Flush()
}

func writeWebSocketPing(rw *bufio.ReadWriter) error {
	header := []byte{0x89, 0x00}
	if _, err := rw.Write(header); err != nil {
		return err
	}
	return rw.Flush()
}

func writeWebSocketFrame(w io.Writer, payload []byte) error {
	header := []byte{0x81}
	switch {
	case len(payload) < 126:
		header = append(header, byte(len(payload)))
	case len(payload) <= 65535:
		header = append(header, 126, byte(len(payload)>>8), byte(len(payload)))
	default:
		header = append(header, 127)
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(len(payload)))
		header = append(header, size[:]...)
	}
	if _, err := w.Write(header); err != nil {
		return err
	}
	_, err := w.Write(payload)
	return err
}

func readWebSocketMessage(r io.Reader) ([]byte, error) {
	var hdr [2]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	opcode := hdr[0] & 0x0f
	if opcode == 0x8 {
		return nil, io.EOF
	}
	masked := hdr[1]&0x80 != 0
	length := int(hdr[1] & 0x7f)
	switch length {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(r, ext[:]); err != nil {
			return nil, err
		}
		length = int(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(r, ext[:]); err != nil {
			return nil, err
		}
		length = int(binary.BigEndian.Uint64(ext[:]))
	}
	if length > maxWebSocketMessageSize {
		return nil, errors.New("websocket message too large")
	}
	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(r, mask[:]); err != nil {
			return nil, err
		}
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		return nil, err
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return payload, nil
}
