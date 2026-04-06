package commands

import (
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"testing/quick"

	"wiki-cli/client"
)

// Feature: wiki-cli, Property 5: Move request construction
// **Validates: Requirements 8.1, 8.2**

// moveInput holds generated test inputs for the move property test.
type moveInput struct {
	PageID      int
	Destination string
	Locale      string // empty means omitted
}

// Generate implements quick.Generator for moveInput.
func (moveInput) Generate(r *rand.Rand, size int) reflect.Value {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"

	// Generate positive page ID (1 to 10000)
	pageID := r.Intn(10000) + 1

	// Generate non-empty alphanumeric destination path
	destLen := r.Intn(size+1) + 1
	destBuf := make([]byte, destLen)
	for i := range destBuf {
		destBuf[i] = chars[r.Intn(len(chars))]
	}
	destination := string(destBuf)

	// Optionally generate locale (50% chance)
	var locale string
	if r.Intn(2) == 1 {
		localeLen := r.Intn(size+1) + 1
		localeBuf := make([]byte, localeLen)
		for i := range localeBuf {
			localeBuf[i] = chars[r.Intn(len(chars))]
		}
		locale = string(localeBuf)
	}

	return reflect.ValueOf(moveInput{
		PageID:      pageID,
		Destination: destination,
		Locale:      locale,
	})
}

func TestMoveRequestConstruction(t *testing.T) {
	cfg := &quick.Config{MaxCount: 100}

	err := quick.Check(func(input moveInput) bool {
		var capturedMethod string
		var capturedPath string
		var capturedBody []byte

		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			capturedMethod = r.Method
			capturedPath = r.URL.Path
			var readErr error
			capturedBody, readErr = io.ReadAll(r.Body)
			if readErr != nil {
				t.Logf("failed to read request body: %v", readErr)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{"id":1}`)
		}))
		defer ts.Close()

		c := &client.Client{
			BaseURL:    ts.URL,
			APIKey:     "test-key",
			HTTPClient: ts.Client(),
		}

		// Build args
		args := []string{
			"--id", fmt.Sprintf("%d", input.PageID),
			"--destination", input.Destination,
		}
		if input.Locale != "" {
			args = append(args, "--locale", input.Locale)
		}

		err := Move(c, args, true)
		if err != nil {
			t.Logf("Move returned error: %v", err)
			return false
		}

		// Verify HTTP method is POST
		if capturedMethod != http.MethodPost {
			t.Logf("expected POST, got %s", capturedMethod)
			return false
		}

		// Verify path is /api/pages/<id>/move
		expectedPath := fmt.Sprintf("/api/pages/%d/move", input.PageID)
		if capturedPath != expectedPath {
			t.Logf("expected %s, got %s", expectedPath, capturedPath)
			return false
		}

		// Verify JSON body has correct fields
		var body client.MovePageRequest
		if err := json.Unmarshal(capturedBody, &body); err != nil {
			t.Logf("failed to unmarshal request body: %v", err)
			return false
		}

		if body.DestinationPath != input.Destination {
			t.Logf("expected destination_path %q, got %q", input.Destination, body.DestinationPath)
			return false
		}

		if body.DestinationLocale != input.Locale {
			t.Logf("expected destination_locale %q, got %q", input.Locale, body.DestinationLocale)
			return false
		}

		return true
	}, cfg)

	if err != nil {
		t.Errorf("Property 5 failed: %v", err)
	}
}
