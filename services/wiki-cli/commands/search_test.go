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

// Feature: wiki-cli, Property 1: Search request construction
// **Validates: Requirements 2.1, 2.2**

// searchInput holds generated test inputs for the search property test.
type searchInput struct {
	Query string
	TopK  int
}

// Generate implements quick.Generator for searchInput.
// Produces non-empty query strings and top_k values in [1, 20].
func (searchInput) Generate(rand *rand.Rand, size int) reflect.Value {
	// Generate a non-empty query string of printable ASCII characters.
	// Avoid leading '-' so the flag parser doesn't treat the query as a flag.
	length := rand.Intn(size+1) + 1 // at least 1 character
	buf := make([]byte, length)
	for i := range buf {
		// printable ASCII range 33-126 (avoid control chars)
		buf[i] = byte(33 + rand.Intn(94))
	}
	// Ensure first character is a letter (a-z) to avoid flag-like strings
	buf[0] = byte('a' + rand.Intn(26))
	topK := rand.Intn(20) + 1 // [1, 20]
	return reflect.ValueOf(searchInput{Query: string(buf), TopK: topK})
}

func TestSearchRequestConstruction(t *testing.T) {
	cfg := &quick.Config{MaxCount: 100}

	err := quick.Check(func(input searchInput) bool {
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
			fmt.Fprint(w, `{"results":[]}`)
		}))
		defer ts.Close()

		c := &client.Client{
			BaseURL:    ts.URL,
			APIKey:     "test-key",
			HTTPClient: ts.Client(),
		}

		args := []string{"--top", fmt.Sprintf("%d", input.TopK), input.Query}
		_ = Search(c, args)

		// Verify HTTP method is POST
		if capturedMethod != http.MethodPost {
			t.Logf("expected POST, got %s", capturedMethod)
			return false
		}

		// Verify path is /api/search
		if capturedPath != "/api/search" {
			t.Logf("expected /api/search, got %s", capturedPath)
			return false
		}

		// Verify JSON body has correct query and top_k
		var body client.SearchRequest
		if err := json.Unmarshal(capturedBody, &body); err != nil {
			t.Logf("failed to unmarshal request body: %v", err)
			return false
		}

		if body.Query != input.Query {
			t.Logf("expected query %q, got %q", input.Query, body.Query)
			return false
		}

		if body.TopK != input.TopK {
			t.Logf("expected top_k %d, got %d", input.TopK, body.TopK)
			return false
		}

		return true
	}, cfg)

	if err != nil {
		t.Errorf("Property 1 failed: %v", err)
	}
}
