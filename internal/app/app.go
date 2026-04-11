package app

import (
	"fmt"
	"io"

	"github.com/zenzenzen/watch-my-token-burn/internal/config"
)

type Runner struct {
	Stdout io.Writer
	Stderr io.Writer
}

func (r Runner) Run(args []string) int {
	cfg, err := config.Parse(args)
	if err != nil {
		_, _ = fmt.Fprintf(r.Stderr, "token-gauge (Go preview): %v\n", err)
		return 1
	}

	if cfg.Help {
		_, _ = io.WriteString(r.Stdout, config.HelpText())
		return 0
	}

	_, _ = fmt.Fprintln(r.Stdout, "token-gauge Go preview is scaffolded for the staged migration.")
	_, _ = fmt.Fprintln(r.Stdout, "Use the Node.js entrypoint for production behavior while collector, snapshot, and TUI parity land.")
	return 0
}
