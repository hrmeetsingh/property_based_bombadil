// stocktui draws a 30-day line chart of a fictional stock in the terminal.
// Use the arrow keys (or h/l, Home/End, g/G) to select a day: the chart marks
// that day's price and draws a dotted line from the x-axis up to it.
package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
)

func main() {
	stock, err := loadStock()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	p := tea.NewProgram(newModel(stock), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
