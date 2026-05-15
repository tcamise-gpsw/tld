package watch

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestEventQueueDeliversBufferedEventsOnClose(t *testing.T) {
	queue := NewEventQueue()
	queue.Push(Event{Type: "first"})
	queue.Push(Event{Type: "second"})
	queue.Close()

	var got []string
	for {
		select {
		case event, ok := <-queue.Out():
			if !ok {
				if len(got) != 2 || got[0] != "first" || got[1] != "second" {
					t.Fatalf("unexpected events after close: %v", got)
				}
				return
			}
			got = append(got, event.Type)
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for queue to close; got %v", got)
		}
	}
}

func TestEventQueuePushCloseRaceDoesNotPanic(t *testing.T) {
	queue := NewEventQueue()
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			for j := 0; j < 1_000; j++ {
				queue.Push(Event{Type: fmt.Sprintf("%d:%d", worker, j)})
			}
		}(i)
	}

	queue.Close()
	wg.Wait()

	for {
		select {
		case _, ok := <-queue.Out():
			if !ok {
				queue.Push(Event{Type: "after-close"})
				return
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for queue to close")
		}
	}
}
