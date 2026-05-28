package term

import (
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	xterm "golang.org/x/term"
)

const defaultProgressThrottle = 60 * time.Millisecond
const defaultProgressWidth = 80

type ProgressLineOptions struct {
	ForceTerminal  bool
	NoFinishedLine bool
	FinishedWriter io.Writer
	Throttle       time.Duration
	Width          int
	Now            func() time.Time
}

type ProgressLine struct {
	out         io.Writer
	finishedOut io.Writer
	now         func() time.Time
	throttle    time.Duration
	width       int

	mu          sync.Mutex
	label       string
	detail      string
	total       int64
	current     int64
	started     time.Time
	lastRender  time.Time
	lastCurrent int64
	rendered    bool
	forceRender bool
	finished    bool
}

func NewProgressLine(out io.Writer, opts ProgressLineOptions) *ProgressLine {
	if out == nil || (!opts.ForceTerminal && !IsTerminal(out)) {
		return nil
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	throttle := opts.Throttle
	if throttle == 0 {
		throttle = defaultProgressThrottle
	}
	finishedOut := opts.FinishedWriter
	if finishedOut == nil {
		finishedOut = out
	}
	return &ProgressLine{out: out, finishedOut: finishedOut, now: now, throttle: throttle, width: terminalWidth(out, opts.Width), finished: !opts.NoFinishedLine}
}

func (p *ProgressLine) Start(label string, total int) {
	if p == nil {
		return
	}
	p.Start64(label, int64(total))
}

func (p *ProgressLine) Start64(label string, total int64) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.label = strings.TrimSpace(label)
	p.detail = ""
	p.total = total
	p.current = 0
	p.started = p.now()
	p.lastRender = time.Time{}
	p.lastCurrent = -1
	p.forceRender = true
	p.renderLocked()
}

func (p *ProgressLine) Advance(label string) {
	if p == nil {
		return
	}
	p.Add(1, label)
}

func (p *ProgressLine) Add(n int64, detail string) int64 {
	if p == nil {
		return 0
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.activeLocked() {
		return 0
	}
	if strings.TrimSpace(detail) != "" {
		p.detail = strings.TrimSpace(detail)
	}
	p.current += n
	if p.total > 0 && p.current > p.total {
		p.current = p.total
	}
	p.renderLocked()
	return p.current
}

func (p *ProgressLine) Set(label, detail string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if strings.TrimSpace(label) != "" {
		p.label = strings.TrimSpace(label)
	}
	if strings.TrimSpace(detail) != "" {
		p.detail = strings.TrimSpace(detail)
	}
	if p.started.IsZero() {
		p.started = p.now()
	}
	p.forceRender = true
	p.renderLocked()
}

func (p *ProgressLine) Finish() {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.now()
	if p.activeLocked() && p.total > 0 && p.current < p.total {
		p.current = p.total
	}
	if p.activeLocked() {
		p.forceRender = true
		p.renderLockedAt(now)
	}
	if p.rendered {
		_, _ = fmt.Fprint(p.out, "\r\033[K")
	}
	if p.finished && p.finishedOut != nil && strings.TrimSpace(p.label) != "" {
		_, _ = fmt.Fprintf(p.finishedOut, "%s\n", p.finishedLineLocked(now))
	}
	p.label = ""
	p.detail = ""
	p.total = 0
	p.current = 0
	p.started = time.Time{}
	p.lastRender = time.Time{}
	p.lastCurrent = -1
	p.rendered = false
	p.forceRender = false
}

func (p *ProgressLine) activeLocked() bool {
	return p.label != "" || !p.started.IsZero()
}

func (p *ProgressLine) renderLocked() {
	now := p.now()
	p.renderLockedAt(now)
}

func (p *ProgressLine) renderLockedAt(now time.Time) {
	if p.total > 0 && p.current != p.lastCurrent {
		currentPercent := int((float64(p.current) / float64(p.total)) * 100)
		lastPercent := -1
		if p.lastCurrent >= 0 {
			lastPercent = int((float64(p.lastCurrent) / float64(p.total)) * 100)
		}
		if p.total <= 100 || currentPercent != lastPercent || p.current == p.total {
			p.forceRender = true
		}
	}
	if !p.forceRender && !p.lastRender.IsZero() && p.throttle > 0 && now.Sub(p.lastRender) < p.throttle {
		return
	}
	p.forceRender = false
	p.lastRender = now
	p.lastCurrent = p.current
	_, _ = fmt.Fprintf(p.out, "\r\033[K%s", p.formatLocked(now))
	p.rendered = true
}

func (p *ProgressLine) formatLocked(now time.Time) string {
	label := p.label
	if label == "" {
		label = "Working"
	}
	labelText := fmt.Sprintf("%12s", label)
	plainParts := []string{labelText}
	if p.total > 0 {
		percent := int((float64(p.current) / float64(p.total)) * 100)
		if percent > 100 {
			percent = 100
		}
		plainParts = append(plainParts, fmt.Sprintf("%d/%d", p.current, p.total), fmt.Sprintf("%d%%", percent))
	}
	elapsed := now.Sub(p.started).Round(time.Second)
	if elapsed < 0 {
		elapsed = 0
	}
	plainParts = append(plainParts, "elapsed "+formatDuration(elapsed))
	if p.current > 0 {
		rateElapsed := now.Sub(p.started).Seconds()
		if rateElapsed > 0 {
			plainParts = append(plainParts, fmt.Sprintf("%.1f/s", float64(p.current)/rateElapsed))
		}
	}
	basePlain := strings.Join(plainParts, " ")
	baseStyled := strings.Join(append([]string{Colorize(p.out, ColorGreen+ColorBold, labelText)}, plainParts[1:]...), " ")
	if len([]rune(basePlain)) >= p.width {
		return truncateEnd(basePlain, p.width)
	}
	if p.detail != "" {
		remaining := p.width - len([]rune(basePlain)) - 1
		if remaining > 0 {
			return baseStyled + " " + Dim(p.out, truncateMiddle(p.detail, remaining))
		}
	}
	return baseStyled
}

func (p *ProgressLine) finishedLineLocked(now time.Time) string {
	elapsed := now.Sub(p.started).Round(time.Second)
	if elapsed < 0 {
		elapsed = 0
	}
	label := strings.TrimSpace(p.label)
	line := fmt.Sprintf("    Finished %s in %s", label, formatDuration(elapsed))
	if p.total > 0 {
		line = fmt.Sprintf("%s (%d/%d)", line, p.current, p.total)
	}
	return truncateEnd(line, p.width)
}

func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return d.String()
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm%02ds", int(d.Minutes()), int(d.Seconds())%60)
	}
	return fmt.Sprintf("%dh%02dm%02ds", int(d.Hours()), int(d.Minutes())%60, int(d.Seconds())%60)
}

type byteProgressWriter struct {
	line *ProgressLine
}

func NewByteProgressWriter(out io.Writer, total int64, label string) io.Writer {
	line := NewProgressLine(out, ProgressLineOptions{})
	if line == nil || total <= 0 {
		return io.Discard
	}
	line.Start64(label, total)
	return &byteProgressWriter{line: line}
}

func (w *byteProgressWriter) Write(p []byte) (int, error) {
	if w == nil || w.line == nil {
		return len(p), nil
	}
	current := w.line.Add(int64(len(p)), "")
	w.line.Set("", formatBytes(current))
	if w.line.isComplete() {
		w.line.Finish()
	}
	return len(p), nil
}

func (w *byteProgressWriter) Close() error {
	if w != nil && w.line != nil {
		w.line.Finish()
	}
	return nil
}

func (p *ProgressLine) isComplete() bool {
	if p == nil {
		return false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.total > 0 && p.current >= p.total
}

func terminalWidth(out io.Writer, configured int) int {
	if configured > 0 {
		return configured
	}
	if f, ok := out.(*os.File); ok {
		width, _, err := xterm.GetSize(int(f.Fd()))
		if err == nil && width > 0 {
			return width
		}
	}
	if value := strings.TrimSpace(os.Getenv("COLUMNS")); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			return parsed
		}
	}
	return defaultProgressWidth
}

func truncateMiddle(value string, width int) string {
	if width <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= width {
		return value
	}
	if width == 1 {
		return "…"
	}
	if width == 2 {
		return "…"
	}
	left := (width - 1) / 2
	right := width - 1 - left
	return string(runes[:left]) + "…" + string(runes[len(runes)-right:])
}

func truncateEnd(value string, width int) string {
	if width <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= width {
		return value
	}
	if width == 1 {
		return "…"
	}
	return string(runes[:width-1]) + "…"
}

func formatBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for next := div * unit; n >= next && exp < 4; next = div * unit {
		div = next
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(n)/float64(div), "KMGTPE"[exp])
}
