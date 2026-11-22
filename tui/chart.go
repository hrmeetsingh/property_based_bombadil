package main

import (
	"fmt"
	"math"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// Screen layout. The Bombadil spec (specs/tui.spec.ts) reads the screen
// using the same numbers, so keep the two in sync.
const (
	TitleRow    = 0
	ChartTop    = 2  // first row of the plot area
	ChartHeight = 16 // rows in the plot area
	AxisRow     = ChartTop + ChartHeight
	DayLabelRow = AxisRow + 1
	StatusRow   = AxisRow + 3
	HelpRow     = AxisRow + 5
	YAxisCol    = 9  // column of the y-axis line
	FirstDayCol = 11 // column of day 1
	DayStep     = 2  // columns between two days

	ScreenRows = HelpRow + 1
	ScreenCols = 100
)

// Glyphs drawn on the chart.
const (
	PointGlyph    = '•' // a day's closing price
	MarkerGlyph   = '●' // the selected day's closing price
	DottedGlyph   = '┊' // dotted line from the x-axis up to the marker
	FlatGlyph     = '─'
	UpGlyph       = '╱'
	DownGlyph     = '╲'
	AxisGlyph     = '─'
	TickGlyph     = '┴'
	CornerGlyph   = '└'
	YAxisGlyph    = '│'
	YLabelGlyph   = '┤'
	EmptyGlyph    = ' '
)

// Cell highlight kinds.
const (
	highlightNone = iota
	highlightOn
)

// DayCol is the screen column of a 0-based day index.
func DayCol(index int) int { return FirstDayCol + index*DayStep }

// PriceRow maps a price onto a plot row: the highest price is on ChartTop,
// the lowest on the bottom row of the plot area.
func PriceRow(price, min, max float64) int {
	if max == min {
		return ChartTop + ChartHeight/2
	}
	frac := (max - price) / (max - min)
	return ChartTop + int(math.Round(frac*float64(ChartHeight-1)))
}

func priceRange(days []Day) (float64, float64) {
	min, max := days[0].Price, days[0].Price
	for _, d := range days {
		min = math.Min(min, d.Price)
		max = math.Max(max, d.Price)
	}
	return min, max
}

type cell struct {
	r         rune
	highlight int
}

type canvas [][]cell

func newCanvas() canvas {
	c := make(canvas, ScreenRows)
	for i := range c {
		c[i] = make([]cell, ScreenCols)
		for j := range c[i] {
			c[i][j] = cell{r: EmptyGlyph}
		}
	}
	return c
}

func (c canvas) set(row, col int, r rune, hl int) {
	if row < 0 || row >= len(c) || col < 0 || col >= len(c[row]) {
		return
	}
	c[row][col] = cell{r: r, highlight: hl}
}

func (c canvas) text(row, col int, s string) {
	for i, r := range []rune(s) {
		c.set(row, col+i, r, highlightNone)
	}
}

// drawChart draws the price line, the axes and the highlight for the
// selected day (0-based index).
func drawChart(c canvas, stock Stock, selected int) {
	days := stock.Days
	min, max := priceRange(days)

	c.text(TitleRow, 0, fmt.Sprintf("%s · %s · %d-day closing price", stock.Symbol, stock.Name, len(days)))

	// Y axis with labels for the top, middle and bottom rows.
	mid := ChartTop + (ChartHeight-1)/2
	for row := ChartTop; row < AxisRow; row++ {
		c.set(row, YAxisCol, YAxisGlyph, highlightNone)
	}
	for _, row := range []int{ChartTop, mid, AxisRow - 1} {
		frac := float64(row-ChartTop) / float64(ChartHeight-1)
		c.text(row, 0, fmt.Sprintf("%8.2f", max-frac*(max-min)))
		c.set(row, YAxisCol, YLabelGlyph, highlightNone)
	}

	// X axis with a tick under every day, and labels for some days.
	c.set(AxisRow, YAxisCol, CornerGlyph, highlightNone)
	for col := YAxisCol + 1; col <= DayCol(len(days)-1)+1; col++ {
		c.set(AxisRow, col, AxisGlyph, highlightNone)
	}
	for i, d := range days {
		c.set(AxisRow, DayCol(i), TickGlyph, highlightNone)
		if d.Day == 1 || d.Day%5 == 0 {
			c.text(DayLabelRow, DayCol(i), fmt.Sprint(d.Day))
		}
	}

	// The line: one point per day, joined by a slope glyph in the gap.
	for i, d := range days {
		row := PriceRow(d.Price, min, max)
		c.set(row, DayCol(i), PointGlyph, highlightNone)
		if i+1 < len(days) {
			next := PriceRow(days[i+1].Price, min, max)
			glyph := FlatGlyph
			switch {
			case next < row:
				glyph = UpGlyph
			case next > row:
				glyph = DownGlyph
			}
			c.set((row+next)/2, DayCol(i)+1, glyph, highlightNone)
		}
	}

	// The highlight: a dotted line from just above the x-axis up to the
	// selected day's point, which is drawn as a marker.
	if selected >= 0 && selected < len(days) {
		col := DayCol(selected)
		markerRow := PriceRow(days[selected].Price, min, max)
		for row := AxisRow - 1; row > markerRow; row-- {
			c.set(row, col, DottedGlyph, highlightOn)
		}
		c.set(markerRow, col, MarkerGlyph, highlightOn)
		c.set(AxisRow, col, TickGlyph, highlightOn)
	}
}

var highlightStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("11")).Bold(true)

func (c canvas) render() string {
	var b strings.Builder
	for i, row := range c {
		var line strings.Builder
		for _, cl := range row {
			if cl.highlight == highlightOn {
				line.WriteString(highlightStyle.Render(string(cl.r)))
			} else {
				line.WriteRune(cl.r)
			}
		}
		b.WriteString(strings.TrimRight(line.String(), " "))
		if i < len(c)-1 {
			b.WriteByte('\n')
		}
	}
	return b.String()
}
