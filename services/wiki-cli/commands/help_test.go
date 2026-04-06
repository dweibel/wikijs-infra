package commands

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"testing/quick"
)

// Feature: wiki-cli, Property 11: Per-command help contains required information
// **Validates: Requirements 12.2, 12.5**

// commandExpectedContent defines the expected substrings that must appear
// in the per-command help output for each valid command.
var commandExpectedContent = map[string][]string{
	"search": {"query", "top", "integer", "required", "optional", "Example"},
	"get":    {"id", "path", "integer", "string", "optional", "Example"},
	"list":   {"Example"},
	"create": {"title", "path", "content", "description", "tags", "string", "required", "optional", "Example"},
	"update": {"id", "title", "content", "description", "tags", "integer", "string", "required", "optional", "Example"},
	"delete": {"id", "integer", "required", "Example"},
	"move":   {"id", "destination", "locale", "integer", "string", "required", "optional", "Example"},
	"help":   {"Example"},
}

// captureHelpStdout calls Help with the given args and captures stdout output.
func captureHelpStdout(args []string) (string, error) {
	origStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		return "", fmt.Errorf("failed to create pipe: %w", err)
	}
	os.Stdout = w

	helpErr := Help(args)

	w.Close()
	os.Stdout = origStdout

	var buf bytes.Buffer
	io.Copy(&buf, r)
	r.Close()

	return buf.String(), helpErr
}

func TestPerCommandHelpContainsRequiredInformation(t *testing.T) {
	for _, cmd := range validCommands {
		t.Run(cmd, func(t *testing.T) {
			output, err := captureHelpStdout([]string{cmd})
			if err != nil {
				t.Fatalf("help %s returned error: %v", cmd, err)
			}

			// Verify command name appears in output
			if !strings.Contains(output, cmd) {
				t.Errorf("help %s output missing command name %q", cmd, cmd)
			}

			// Verify all expected substrings are present (case-insensitive)
			expected := commandExpectedContent[cmd]
			lower := strings.ToLower(output)
			for _, substr := range expected {
				if !strings.Contains(lower, strings.ToLower(substr)) {
					t.Errorf("help %s output missing expected content %q\nOutput:\n%s", cmd, substr, output)
				}
			}
		})
	}
}

// Feature: wiki-cli, Property 13: Unknown command error lists valid commands
// **Validates: Requirements 12.4, 13.2**

// isValidCommand returns true if s matches a recognized command name.
func isValidCommand(s string) bool {
	for _, cmd := range validCommands {
		if s == cmd {
			return true
		}
	}
	return false
}

// captureHelpStderr calls Help with the given args and captures stderr output.
func captureHelpStderr(args []string) (string, error) {
	origStderr := os.Stderr
	r, w, err := os.Pipe()
	if err != nil {
		return "", fmt.Errorf("failed to create pipe: %w", err)
	}
	os.Stderr = w

	helpErr := Help(args)

	w.Close()
	os.Stderr = origStderr

	var buf bytes.Buffer
	io.Copy(&buf, r)
	r.Close()

	return buf.String(), helpErr
}

func TestProperty13_UnknownCommandErrorListsValidCommands(t *testing.T) {
	// Property: for any string that is NOT a valid command name,
	// Help([]string{s}) should return an error, and stderr should
	// list all valid commands and include a help hint.
	f := func(s string) bool {
		// Skip strings that are valid commands — we only test unknown ones.
		if isValidCommand(s) {
			return true
		}

		stderrOutput, err := captureHelpStderr([]string{s})

		// Must return an error for unknown commands.
		if err == nil {
			t.Logf("expected error for unknown command %q, got nil", s)
			return false
		}

		// Stderr must list every valid command name.
		for _, cmd := range validCommands {
			if !strings.Contains(stderrOutput, cmd) {
				t.Logf("stderr for unknown command %q missing valid command %q\nStderr:\n%s", s, cmd, stderrOutput)
				return false
			}
		}

		// Stderr must include a help hint.
		if !strings.Contains(stderrOutput, "wiki-cli help") {
			t.Logf("stderr for unknown command %q missing help hint\nStderr:\n%s", s, stderrOutput)
			return false
		}

		return true
	}

	if err := quick.Check(f, nil); err != nil {
		t.Errorf("Property 13 failed: %v", err)
	}
}

// Feature: wiki-cli, Property 15: Write command help mentions ENABLE_WRITE_OPS
// **Validates: Requirements 12.6**

func TestProperty15_WriteCommandHelpMentionsEnableWriteOps(t *testing.T) {
	writeCommands := []string{"create", "update", "delete", "move"}

	for _, cmd := range writeCommands {
		t.Run(cmd, func(t *testing.T) {
			output, err := captureHelpStdout([]string{cmd})
			if err != nil {
				t.Fatalf("help %s returned error: %v", cmd, err)
			}

			if !strings.Contains(output, "ENABLE_WRITE_OPS") {
				t.Errorf("help %s output does not mention ENABLE_WRITE_OPS\nOutput:\n%s", cmd, output)
			}
		})
	}
}
