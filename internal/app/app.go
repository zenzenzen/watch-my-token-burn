package app

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/zenzenzen/watch-my-token-burn/internal/config"
)

type Runner struct {
	Stdout io.Writer
	Stderr io.Writer
	RunCommand     func(name string, args []string, stdout io.Writer, stderr io.Writer) error
	Getenv         func(key string) string
	FileExists     func(path string) bool
	ExecutablePath func() (string, error)
}

func (r Runner) Run(args []string) int {
	cfg, err := config.Parse(args)
	if err != nil {
		_, _ = fmt.Fprintf(r.Stderr, "token-gauge (Go preview): %v\n", err)
		return 1
	}

	nodeEntrypoint := r.findNodeEntrypoint()
	if nodeEntrypoint != "" {
		if err := r.runCommand("node", append([]string{nodeEntrypoint}, args...), r.Stdout, r.Stderr); err != nil {
			_, _ = fmt.Fprintf(r.Stderr, "token-gauge (Go preview): node fallback failed: %v\n", err)
			return 1
		}
		return 0
	}

	if cfg.Help {
		_, _ = io.WriteString(r.Stdout, config.HelpText())
		return 0
	}

	_, _ = fmt.Fprintln(r.Stdout, "token-gauge Go preview is scaffolded for the staged migration.")
	_, _ = fmt.Fprintln(r.Stdout, "Use the Node.js entrypoint for production behavior while collector, snapshot, and TUI parity land.")
	return 0
}

func (r Runner) runCommand(name string, args []string, stdout io.Writer, stderr io.Writer) error {
	if r.RunCommand != nil {
		return r.RunCommand(name, args, stdout, stderr)
	}

	cmd := exec.Command(name, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	return cmd.Run()
}

func (r Runner) findNodeEntrypoint() string {
	fileExists := r.FileExists
	if fileExists == nil {
		fileExists = func(path string) bool {
			info, err := os.Stat(path)
			return err == nil && !info.IsDir()
		}
	}

	getenv := r.Getenv
	if getenv == nil {
		getenv = os.Getenv
	}

	if explicit := getenv("TOKEN_GAUGE_NODE_ENTRYPOINT"); explicit != "" && fileExists(explicit) {
		return explicit
	}

	candidates := []string{}
	if repoDir := getenv("TOKEN_GAUGE_REPO_DIR"); repoDir != "" {
		candidates = append(candidates, filepath.Join(repoDir, "src", "main.js"))
	}

	executablePath := r.ExecutablePath
	if executablePath == nil {
		executablePath = os.Executable
	}

	if exePath, err := executablePath(); err == nil && exePath != "" {
		exeDir := filepath.Dir(exePath)
		candidates = append(
			candidates,
			filepath.Join(exeDir, "src", "main.js"),
			filepath.Join(filepath.Dir(exeDir), "src", "main.js"),
		)
	}

	for _, candidate := range candidates {
		if fileExists(candidate) {
			return candidate
		}
	}

	return ""
}
