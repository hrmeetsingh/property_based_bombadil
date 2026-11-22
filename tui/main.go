// BMBDL TUI: a mocked stock performance screen.
//
// Layout (top to bottom):
//
//	row 0        : title (always present, even before the first resize)
//	row 1        : status line "Day: 07/30  Close: $149.40"
//	rows 2..H-3  : plot area - the price line graph, the selected day's
//	               point "*", and a vertical dotted line ":" from the
//	               x-axis up to that point
//	row H-2      : x-axis line ("-"), interrupted by the dotted line
//	row H-1      : x-axis labels; the selected day is bracketed, e.g. [07]
//
// Key mappings:
//
//	left / h  : select the previous day
//	right / l : select the next day
//	q         : quit (exit code 0)
//	anything else is ignored
//
// All rendering is done into a full terminal-sized rune canvas so that a
// frame never wraps, at any terminal size (including degenerate ones).
package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strings"

	"github.com/charmbracelet/bubbletea"
)

//go:embed stock.json
var stockJSON []byte

const (
	titleText     = "BMBDL - Mock Stock Performance"
	plotTopRow    = 2
	minCols       = 20
	minRows       = 6
	lineChar      = '.'
	pointChar     = '*'
	dottedChar    = ':'
	axisChar      = '-'
	defaultWidth  = 80 // used until the first WindowSizeMsg arrives
	defaultHeight = 24
)

type model struct {
	width    int
	height   int
	selected int
	prices   []float64
	quitting bool
}

func loadPrices() ([]float64, error) {
	// stock.json is a bare array of closing prices.
	var prices []float64
	if err := json.Unmarshal(stockJSON, &prices); err != nil {
		return nil, fmt.Errorf("decode stock.json: %w", err)
	}
	if len(prices) == 0 {
		return nil, fmt.Errorf("stock.json contains no prices")
	}
	return prices, nil
}

func (m model) Init() tea.Cmd {
	return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	case tea.KeyMsg:
		switch msg.String() {
		case "left", "h":
			if m.selected > 0 {
				m.selected--
			}
		case "right", "l":
			if m.selected < len(m.prices)-1 {
				m.selected++
			}
		case "q", "ctrl+c":
			m.quitting = true
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m model) View() string {
	if m.quitting {
		return ""
	}
	width := m.width
	height := m.height
	if width <= 0 {
		width = defaultWidth
	}
	if height <= 0 {
		height = defaultHeight
	}

	// Full-size rune canvas; every frame is exactly width x height so no
	// line ever wraps and no stale content survives a repaint.
	canvas := make([][]rune, height)
	for r := range canvas {
		row := make([]rune, width)
		for c := range row {
			row[c] = ' '
		}
		canvas[r] = row
	}

	write := func(row int, col int, text string) {
		if row < 0 || row >= height {
			return
		}
		for i, ch := range text {
			c := col + i
			if c < 0 || c >= width {
				continue
			}
			canvas[row][c] = ch
		}
	}

	// Row 0: title (always).
	write(0, 0, titleText)

	// Row 1: status line (always). Day index is 0-based, matching the
	// x-axis labels and the dataset indices used by the spec.
	day := m.selected
	status := fmt.Sprintf("Day: %02d/%02d  Close: $%.2f", day, len(m.prices), m.prices[day])
	write(1, 0, status)

	// Degenerate terminals: title + status only.
	if height < minRows || width < minCols {
		return joinCanvas(canvas)
	}

	plotHeight := height - 4 // rows 2 .. height-3
	axisRow := height - 2
	labelRow := height - 1

	minPrice, maxPrice := minMax(m.prices)
	priceRange := maxPrice - minPrice
	if priceRange == 0 {
		priceRange = 1
	}

	rowForPrice := func(p float64) int {
		frac := (maxPrice - p) / priceRange
		row := plotTopRow + int(math.Round(frac*float64(plotHeight-1)))
		if row < plotTopRow {
			row = plotTopRow
		}
		if row > axisRow-1 {
			row = axisRow - 1
		}
		return row
	}

	// The line graph itself: piecewise linear between the columns of
	// consecutive days, so the line passes exactly through every day's
	// price at that day's column (where the "*" is drawn).
	days := len(m.prices)
	for d := 0; d+1 < days; d++ {
		c0, c1 := dayColumn(d, days, width), dayColumn(d+1, days, width)
		for c := c0; c <= c1; c++ {
			p := m.prices[d]
			if c1 > c0 {
				t := float64(c-c0) / float64(c1-c0)
				p = m.prices[d]*(1-t) + m.prices[d+1]*t
			}
			canvas[rowForPrice(p)][c] = lineChar
		}
	}

	// Selected day: x-axis column, its point on the graph, and the
	// vertical dotted line from the x-axis up to that point.
	selCol := dayColumn(day, days, width)
	selRow := rowForPrice(m.prices[day])
	canvas[selRow][selCol] = pointChar
	for r := selRow + 1; r <= axisRow; r++ {
		canvas[r][selCol] = dottedChar
	}

	// X-axis line, interrupted by the dotted line at the selected column.
	for c := 0; c < width; c++ {
		canvas[axisRow][c] = axisChar
	}
	canvas[axisRow][selCol] = dottedChar

	// X-axis labels: every 5th day, selected day bracketed (written last
	// so the bracket always survives an overlap).
	labelCol := func(d int) int {
		// Leave room for the 4-character "[dd]" label.
		return min(dayColumn(d, days, width), width-4)
	}
	for d := 0; d < len(m.prices); d += 5 {
		if d == day {
			continue
		}
		write(labelRow, labelCol(d), fmt.Sprintf("%02d", d))
	}
	write(labelRow, labelCol(day), fmt.Sprintf("[%02d]", day))

	return joinCanvas(canvas)
}

// dayColumn maps a 0-based day index onto a terminal column so that day 0
// is the first column and the last day the last column.
func dayColumn(day, days, width int) int {
	if days <= 1 {
		return 0
	}
	c := int(math.Round(float64(day) * float64(width-1) / float64(days-1)))
	return max(0, min(c, width-1))
}

func joinCanvas(canvas [][]rune) string {
	lines := make([]string, len(canvas))
	for r, row := range canvas {
		// Full width, trailing spaces included: every line always covers the
		// whole terminal row, so a shorter repaint can never leave stale
		// characters from a previous frame behind.
		lines[r] = string(row)
	}
	// No trailing newline: the frame is exactly len(canvas) terminal rows.
	// A trailing newline would push the full-height frame over the bottom
	// edge and scroll the title row off the screen.
	return strings.Join(lines, "\n")
}

func minMax(values []float64) (float64, float64) {
	minV := values[0]
	maxV := values[0]
	for _, v := range values {
		if v < minV {
			minV = v
		}
		if v > maxV {
			maxV = v
		}
	}
	return minV, maxV
}

func main() {
	prices, err := loadPrices()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	m := model{
		width:  defaultWidth,
		height: defaultHeight,
		prices: prices,
	}
	p := tea.NewProgram(m)
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
