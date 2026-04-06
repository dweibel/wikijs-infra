package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"wiki-cli/client"
	"wiki-cli/commands"
)

// Feature: wiki-cli, Property 12: --help flag equivalence
// **Validates: Requirements 12.3**
//
// For each valid command, verify that calling Help([]string{cmd}) produces
// identical output on two separate invocations and returns nil (exit 0).
// In main.go, both "help <command>" and "<command> --help" resolve to
// commands.Help([]string{command}), so output equivalence is guaranteed
// when the function is deterministic.

// captureStdout calls fn and returns whatever it wrote to os.Stdout.
func captureStdout(fn func()) (string, error) {
	origStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		return "", fmt.Errorf("failed to create pipe: %w", err)
	}
	os.Stdout = w

	fn()

	w.Close()
	os.Stdout = origStdout

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, r); err != nil {
		r.Close()
		return "", fmt.Errorf("failed to read pipe: %w", err)
	}
	r.Close()
	return buf.String(), nil
}

func TestProperty12_HelpFlagEquivalence(t *testing.T) {
	// Valid commands that can appear as "<command> --help".
	// "help" is included because "help --help" also routes to Help([]string{"help"}).
	cmds := []string{"search", "get", "list", "create", "update", "delete", "move", "help"}

	for _, cmd := range cmds {
		t.Run(cmd, func(t *testing.T) {
			// Simulate "help <command>" path — calls Help([]string{cmd}).
			var err1 error
			out1, captureErr1 := captureStdout(func() {
				err1 = commands.Help([]string{cmd})
			})
			if captureErr1 != nil {
				t.Fatalf("capture stdout (call 1) failed: %v", captureErr1)
			}

			// Simulate "<command> --help" path — also calls Help([]string{cmd}).
			var err2 error
			out2, captureErr2 := captureStdout(func() {
				err2 = commands.Help([]string{cmd})
			})
			if captureErr2 != nil {
				t.Fatalf("capture stdout (call 2) failed: %v", captureErr2)
			}

			// Both calls must succeed (exit 0).
			if err1 != nil {
				t.Errorf("help %s (call 1) returned error: %v", cmd, err1)
			}
			if err2 != nil {
				t.Errorf("help %s (call 2) returned error: %v", cmd, err2)
			}

			// Output must be identical — proving determinism and equivalence.
			if out1 != out2 {
				t.Errorf("help %s output differs between calls\nCall 1:\n%s\nCall 2:\n%s", cmd, out1, out2)
			}

			// Output must be non-empty.
			if len(out1) == 0 {
				t.Errorf("help %s produced empty output", cmd)
			}
		})
	}
}

// Feature: wiki-cli, Property 14: Error messages include help hints
// **Validates: Requirements 13.1**
//
// For each command that fails due to missing or invalid arguments, verify
// stderr contains a reference to the relevant help command
// (e.g. "wiki-cli help <command>").

// captureStderr calls fn and returns whatever it wrote to os.Stderr.
func captureStderr(fn func()) (string, error) {
	origStderr := os.Stderr
	r, w, err := os.Pipe()
	if err != nil {
		return "", fmt.Errorf("failed to create pipe: %w", err)
	}
	os.Stderr = w

	fn()

	w.Close()
	os.Stderr = origStderr

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, r); err != nil {
		r.Close()
		return "", fmt.Errorf("failed to read pipe: %w", err)
	}
	r.Close()
	return buf.String(), nil
}

func TestProperty14_ErrorMessagesIncludeHelpHints(t *testing.T) {
	// Stand up a dummy HTTP server so the client doesn't fail on connection.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{}`))
	}))
	defer ts.Close()

	c := client.New(ts.URL, "test-api-key")

	// Each test case: command name, function that invokes the command with
	// missing/invalid args, and the expected help hint substring in stderr.
	cases := []struct {
		name     string
		invoke   func()
		wantHint string
	}{
		{
			name:     "search with no query",
			invoke:   func() { commands.Search(c, []string{}) },
			wantHint: "wiki-cli help search",
		},
		{
			name:     "get with no --id or --path",
			invoke:   func() { commands.Get(c, []string{}) },
			wantHint: "wiki-cli help get",
		},
		{
			name:     "create with missing required flags",
			invoke:   func() { commands.Create(c, []string{}, true) },
			wantHint: "wiki-cli help create",
		},
		{
			name:     "update with no --id",
			invoke:   func() { commands.Update(c, []string{}, true) },
			wantHint: "wiki-cli help update",
		},
		{
			name:     "delete with no --id",
			invoke:   func() { commands.Delete(c, []string{}, true) },
			wantHint: "wiki-cli help delete",
		},
		{
			name:     "move with missing required flags",
			invoke:   func() { commands.Move(c, []string{}, true) },
			wantHint: "wiki-cli help move",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stderr, captureErr := captureStderr(func() {
				tc.invoke()
			})
			if captureErr != nil {
				t.Fatalf("failed to capture stderr: %v", captureErr)
			}

			if !strings.Contains(stderr, tc.wantHint) {
				t.Errorf("stderr for %q should contain %q, got:\n%s", tc.name, tc.wantHint, stderr)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Unit tests for main entry point (Task 10.4)
// Uses os/exec to run the compiled binary and check stdout/stderr/exit code.
// Validates: Requirements 1.4, 1.5, 10.4, 13.2
// ---------------------------------------------------------------------------

func buildTestBinary(t *testing.T) string {
	t.Helper()
	binPath := filepath.Join(t.TempDir(), "wiki-cli-test")
	cmd := exec.Command("go", "build", "-o", binPath, "./")
	cmd.Dir = "."
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("failed to build test binary: %v\n%s", err, out)
	}
	return binPath
}

// runBinary executes the test binary with the given args and env overrides.
// Returns stdout, stderr, and the exit code.
func runBinary(t *testing.T, binPath string, args []string, env []string) (stdout, stderr string, exitCode int) {
	t.Helper()
	cmd := exec.Command(binPath, args...)
	// Start with a minimal env to avoid inheriting WIKI_GATEWAY_API_KEY from
	// the host. Callers pass explicit env vars they want set.
	cmd.Env = append([]string{"PATH=" + os.Getenv("PATH")}, env...)

	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf

	err := cmd.Run()
	exitCode = 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			t.Fatalf("failed to run binary: %v", err)
		}
	}
	return outBuf.String(), errBuf.String(), exitCode
}

// TestMain_NoArgs verifies that invoking the CLI with no arguments prints
// usage to stderr and exits with code 1.
// Validates: Requirement 1.4
func TestMain_NoArgs(t *testing.T) {
	bin := buildTestBinary(t)
	_, stderr, exitCode := runBinary(t, bin, nil, nil)

	if exitCode != 1 {
		t.Errorf("expected exit code 1, got %d", exitCode)
	}
	if !strings.Contains(stderr, "Usage") {
		t.Errorf("stderr should contain 'Usage', got:\n%s", stderr)
	}
}

// TestMain_UnknownCommand verifies that an unrecognized command prints an
// error listing valid commands to stderr and exits with code 1.
// Validates: Requirements 1.5, 13.2
func TestMain_UnknownCommand(t *testing.T) {
	bin := buildTestBinary(t)
	// Provide a dummy API key so config loading succeeds and the unknown
	// command dispatch path is reached.
	env := []string{"WIKI_GATEWAY_API_KEY=dummy"}
	_, stderr, exitCode := runBinary(t, bin, []string{"foobar"}, env)

	if exitCode != 1 {
		t.Errorf("expected exit code 1, got %d", exitCode)
	}
	if !strings.Contains(stderr, "unknown command") {
		t.Errorf("stderr should contain 'unknown command', got:\n%s", stderr)
	}
	// Should list valid commands
	for _, cmd := range commands.ValidCommands() {
		if !strings.Contains(stderr, cmd) {
			t.Errorf("stderr should list valid command %q, got:\n%s", cmd, stderr)
		}
	}
	// Should include help hint
	if !strings.Contains(stderr, "wiki-cli help") {
		t.Errorf("stderr should contain 'wiki-cli help' hint, got:\n%s", stderr)
	}
}

// TestMain_HelpNoSubcommand verifies that `help` with no subcommand lists
// all commands on stdout and exits with code 0.
// Validates: Requirement 1.5
func TestMain_HelpNoSubcommand(t *testing.T) {
	bin := buildTestBinary(t)
	stdout, _, exitCode := runBinary(t, bin, []string{"help"}, nil)

	if exitCode != 0 {
		t.Errorf("expected exit code 0, got %d", exitCode)
	}
	// Should list all commands
	for _, cmd := range commands.ValidCommands() {
		if !strings.Contains(stdout, cmd) {
			t.Errorf("stdout should list command %q, got:\n%s", cmd, stdout)
		}
	}
	// Should contain the top-level header
	if !strings.Contains(stdout, "wiki-cli") {
		t.Errorf("stdout should contain 'wiki-cli', got:\n%s", stdout)
	}
}

// TestMain_MissingAPIKey verifies that when WIKI_GATEWAY_API_KEY is not set,
// the CLI prints a config error to stderr and exits with code 1.
// Validates: Requirement 10.4
func TestMain_MissingAPIKey(t *testing.T) {
	bin := buildTestBinary(t)
	// Run a command that requires config (e.g. "list") without setting the API key.
	_, stderr, exitCode := runBinary(t, bin, []string{"list"}, nil)

	if exitCode != 1 {
		t.Errorf("expected exit code 1, got %d", exitCode)
	}
	if !strings.Contains(stderr, "WIKI_GATEWAY_API_KEY") {
		t.Errorf("stderr should mention 'WIKI_GATEWAY_API_KEY', got:\n%s", stderr)
	}
}
