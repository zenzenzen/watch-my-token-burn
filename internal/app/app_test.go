package app

import (
	"bytes"
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
