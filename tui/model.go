package main

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
)

// model is the Bubble Tea state: the data and the selected day.
type model struct {
	stock    Stock
	selected int // 0-based index into stock.Days
}

func newModel(stock Stock) model {
	return model{stock: stock, selected: 0}
}

func (m model) Init() tea.Cmd { return nil }

// Key map:
//
//	← / h      previous day (stops at day 1)
//	→ / l      next day (stops at the last day)
//	Home / g   first day
//	End / G    last day
//	q / Ctrl+C quit
func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	key, ok := msg.(tea.KeyMsg)
	if !ok {
		return m, nil
	}
	last := len(m.stock.Days) - 1
	switch key.String() {
	case "left", "h":
		if m.selected > 0 {
			m.selected--
		}
	case "right", "l":
		if m.selected < len(m.stock.Days) {
			m.selected++
		}
	case "home", "g":
		m.selected = 0
	case "end", "G":
		m.selected = last
	case "q", "ctrl+c":
		return m, tea.Quit
	}
	return m, nil
}

func (m model) View() string {
	c := newCanvas()
	drawChart(c, m.stock, m.selected)
	c.text(StatusRow, 0, m.status())
	c.text(HelpRow, 0, "←/h previous day   →/l next day   Home/g first day   End/G last day   q quit")
	return c.render()
}

// status describes the selected day, e.g.
// "Selected: Day 07 · 2026-10-07 · Price: $113.16 · Change: +0.98".
func (m model) status() string {
	days := m.stock.Days
	i := min(m.selected, len(days)-1) // never index past the data
	d := days[i]
	change := 0.0
	if i > 0 {
		change = d.Price - days[i-1].Price
	}
	return fmt.Sprintf("Selected: Day %02d · %s · Price: $%.2f · Change: %+.2f", m.selected+1, d.Date, d.Price, change)
}
