package main

import (
	"os"

	"github.com/zenzenzen/watch-my-token-burn/internal/app"
)

func main() {
	runner := app.Runner{
		Stdout: os.Stdout,
		Stderr: os.Stderr,
	}
	os.Exit(runner.Run(os.Args[1:]))
}
