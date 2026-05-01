package app

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestRunnerHelpWritesHelpTextToStdout(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	runner := Runner{
		Stdout: &stdout,
		Stderr: &stderr,
	}

	exitCode := runner.Run([]string{"--help"})
	if exitCode != 0 {
		t.Fatalf("expected zero exit code, got %d", exitCode)
	}
	if stderr.Len() != 0 {
		t.Fatalf("expected no stderr output, got %q", stderr.String())
	}
	if !strings.Contains(stdout.String(), "token-gauge (Go preview)") {
		t.Fatalf("expected help output, got %q", stdout.String())
	}
	if !strings.Contains(stdout.String(), "--host <name>") {
		t.Fatalf("expected help flags in output, got %q", stdout.String())
	}
}

func TestRunnerWritesPreviewMessageForNormalExecution(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	runner := Runner{
		Stdout: &stdout,
		Stderr: &stderr,
	}

	exitCode := runner.Run([]string{"--host", "codex", "--provider", "codex"})
	if exitCode != 0 {
		t.Fatalf("expected zero exit code, got %d", exitCode)
	}
	if stderr.Len() != 0 {
		t.Fatalf("expected no stderr output, got %q", stderr.String())
	}
	if !strings.Contains(stdout.String(), "staged migration") {
		t.Fatalf("expected preview message, got %q", stdout.String())
	}
	if !strings.Contains(stdout.String(), "Node.js entrypoint") {
		t.Fatalf("expected production-reference message, got %q", stdout.String())
	}
}

func TestRunnerFallsBackToNodeEntrypointWhenConfigured(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	var commandName string
	var commandArgs []string

	runner := Runner{
		Stdout: &stdout,
		Stderr: &stderr,
		RunCommand: func(name string, args []string, stdout io.Writer, stderr io.Writer) error {
			commandName = name
			commandArgs = append([]string(nil), args...)
			return nil
		},
		Getenv: func(key string) string {
			if key == "TOKEN_GAUGE_NODE_ENTRYPOINT" {
				return "/tmp/token-gauge/src/main.js"
			}
			return ""
		},
		FileExists: func(path string) bool {
			return path == "/tmp/token-gauge/src/main.js"
		},
	}

	exitCode := runner.Run([]string{"--host", "codex", "--provider", "codex"})
	if exitCode != 0 {
		t.Fatalf("expected zero exit code, got %d", exitCode)
	}
	if stderr.Len() != 0 {
		t.Fatalf("expected no stderr output, got %q", stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("expected fallback runner to own stdout, got %q", stdout.String())
	}
	if commandName != "node" {
		t.Fatalf("expected fallback to invoke node, got %q", commandName)
	}
	expectedArgs := []string{"/tmp/token-gauge/src/main.js", "--host", "codex", "--provider", "codex"}
	if strings.Join(commandArgs, "\n") != strings.Join(expectedArgs, "\n") {
		t.Fatalf("unexpected fallback args: got %v want %v", commandArgs, expectedArgs)
	}
}

func TestRunnerReportsFallbackFailuresOnStderr(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	runner := Runner{
		Stdout: &stdout,
		Stderr: &stderr,
		RunCommand: func(name string, args []string, stdout io.Writer, stderr io.Writer) error {
			return errors.New("node missing")
		},
		Getenv: func(key string) string {
			if key == "TOKEN_GAUGE_NODE_ENTRYPOINT" {
				return "/tmp/token-gauge/src/main.js"
			}
			return ""
		},
		FileExists: func(path string) bool {
			return path == "/tmp/token-gauge/src/main.js"
		},
	}

	exitCode := runner.Run([]string{"--host", "codex"})
	if exitCode != 1 {
		t.Fatalf("expected non-zero exit code for fallback failures, got %d", exitCode)
	}
	if stdout.Len() != 0 {
		t.Fatalf("expected no stdout output, got %q", stdout.String())
	}
	if !strings.Contains(stderr.String(), "node fallback failed") {
		t.Fatalf("expected fallback failure message, got %q", stderr.String())
	}
}

func TestRunnerReportsParseFailuresOnStderr(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	runner := Runner{
		Stdout: &stdout,
		Stderr: &stderr,
	}

	exitCode := runner.Run([]string{"--rows", "nope"})
	if exitCode != 1 {
		t.Fatalf("expected non-zero exit code for invalid flags, got %d", exitCode)
	}
	if stdout.Len() != 0 {
		t.Fatalf("expected no stdout output, got %q", stdout.String())
	}
	if !strings.Contains(stderr.String(), "token-gauge (Go preview):") {
		t.Fatalf("expected parse failure prefix on stderr, got %q", stderr.String())
	}
}
