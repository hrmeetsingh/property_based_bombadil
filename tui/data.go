package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

// prices.json is shared with the Bombadil spec (specs/tui.spec.ts), which
// imports the same file to know what the chart should show.
//
//go:embed prices.json
var pricesJSON []byte

// Day is one trading day of the fictional stock.
type Day struct {
	Day   int     `json:"day"`
	Date  string  `json:"date"`
	Price float64 `json:"price"`
}

// Stock is the whole data set drawn by the TUI.
type Stock struct {
	Symbol string `json:"symbol"`
	Name   string `json:"name"`
	Days   []Day  `json:"days"`
}

func loadStock() (Stock, error) {
	var s Stock
	if err := json.Unmarshal(pricesJSON, &s); err != nil {
		return s, fmt.Errorf("parse prices.json: %w", err)
	}
	if len(s.Days) == 0 {
		return s, fmt.Errorf("prices.json has no days")
	}
	return s, nil
}
