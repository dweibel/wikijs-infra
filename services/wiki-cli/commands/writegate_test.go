package commands

import (
	"math/rand"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"testing/quick"

	"wiki-cli/client"
)

// Feature: wiki-cli, Property 6: Write gate rejects with descriptive error
// **Validates: Requirements 5.4, 6.3, 7.3, 8.4, 10.3, 13.3**

// writeGateInput holds generated test inputs for the write gate property test.
type writeGateInput struct {
	// Args to pass to the command (random alphanumeric flag values)
	CreateArgs []string
	UpdateArgs []string
	DeleteArgs []string
	MoveArgs   []string
}

// Generate implements quick.Generator for writeGateInput.
func (writeGateInput) Generate(r *rand.Rand, size int) reflect.Value {
	gen := func() string { return randAlphanumeric(r, size) }

	return reflect.ValueOf(writeGateInput{
		CreateArgs: []string{"--title", gen(), "--path", gen(), "--content", gen()},
		UpdateArgs: []string{"--id", "1", "--title", gen()},
		DeleteArgs: []string{"--id", "1"},
		MoveArgs:   []string{"--id", "1", "--destination", gen()},
	})
}

func TestWriteGateRejectsWithDescriptiveError(t *testing.T) {
	cfg := &quick.Config{MaxCount: 100}

	type cmdEntry struct {
		name string
		fn   func(*client.Client, []string, bool) error
	}

	err := quick.Check(func(input writeGateInput) bool {
		var requestCount int64

		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt64(&requestCount, 1)
			w.WriteHeader(http.StatusOK)
		}))
		defer ts.Close()

		c := &client.Client{
			BaseURL:    ts.URL,
			APIKey:     "test-key",
			HTTPClient: ts.Client(),
		}

		cmds := []cmdEntry{
			{"create", Create},
			{"update", Update},
			{"delete", Delete},
			{"move", Move},
		}

		argsMap := map[string][]string{
			"create": input.CreateArgs,
			"update": input.UpdateArgs,
			"delete": input.DeleteArgs,
			"move":   input.MoveArgs,
		}

		for _, cmd := range cmds {
			args := argsMap[cmd.name]
			cmdErr := cmd.fn(c, args, false)

			// Must return an error
			if cmdErr == nil {
				t.Logf("%s: expected error with writeEnabled=false, got nil", cmd.name)
				return false
			}

			// Error message must mention ENABLE_WRITE_OPS
			if !strings.Contains(cmdErr.Error(), "write operations disabled") {
				t.Logf("%s: error %q does not indicate write operations disabled", cmd.name, cmdErr.Error())
				return false
			}
		}

		// No HTTP requests should have been made
		if count := atomic.LoadInt64(&requestCount); count != 0 {
			t.Logf("expected 0 HTTP requests, got %d", count)
			return false
		}

		return true
	}, cfg)

	if err != nil {
		t.Errorf("Property 6 failed: %v", err)
	}
}
