package commands

import (
	"fmt"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"testing/quick"

	"wiki-cli/client"
)

// Feature: wiki-cli, Property 2: Get command routes by identifier type
// **Validates: Requirements 3.1, 3.2, 3.4**

// getByIDInput holds a generated positive page ID.
type getByIDInput struct {
	PageID int
}

// Generate implements quick.Generator for getByIDInput.
func (getByIDInput) Generate(r *rand.Rand, size int) reflect.Value {
	id := r.Intn(100000) + 1 // positive int [1, 100000]
	return reflect.ValueOf(getByIDInput{PageID: id})
}

// getByPathInput holds a generated alphanumeric page path.
type getByPathInput struct {
	PagePath string
}

// Generate implements quick.Generator for getByPathInput.
func (getByPathInput) Generate(r *rand.Rand, size int) reflect.Value {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	length := r.Intn(size+1) + 1
	buf := make([]byte, length)
	for i := range buf {
		buf[i] = chars[r.Intn(len(chars))]
	}
	return reflect.ValueOf(getByPathInput{PagePath: string(buf)})
}

// getBothInput holds generated page ID and path for the "both provided" scenario.
type getBothInput struct {
	PageID   int
	PagePath string
}

// Generate implements quick.Generator for getBothInput.
func (getBothInput) Generate(r *rand.Rand, size int) reflect.Value {
	id := r.Intn(100000) + 1
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	length := r.Intn(size+1) + 1
	buf := make([]byte, length)
	for i := range buf {
		buf[i] = chars[r.Intn(len(chars))]
	}
	return reflect.ValueOf(getBothInput{PageID: id, PagePath: string(buf)})
}

// TestGetByID verifies that --id <n> routes to GET /api/pages/<n>.
func TestGetByID(t *testing.T) {
	cfg := &quick.Config{MaxCount: 100}

	err := quick.Check(func(input getByIDInput) bool {
		var capturedMethod string
		var capturedPath string

		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			capturedMethod = r.Method
			capturedPath = r.URL.Path
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

		args := []string{"--id", fmt.Sprintf("%d", input.PageID)}
		_ = Get(c, args)

		expectedPath := fmt.Sprintf("/api/pages/%d", input.PageID)

		if capturedMethod != http.MethodGet {
			t.Logf("expected GET, got %s", capturedMethod)
			return false
		}
		if capturedPath != expectedPath {
			t.Logf("expected %s, got %s", expectedPath, capturedPath)
			return false
		}
		return true
	}, cfg)

	if err != nil {
		t.Errorf("Property 2 (--id routing) failed: %v", err)
	}
}

// TestGetByPath verifies that --path <p> routes to GET /api/pages/by-path?path=<p>.
func TestGetByPath(t *testing.T) {
	cfg := &quick.Config{MaxCount: 100}

	err := quick.Check(func(input getByPathInput) bool {
		var capturedMethod string
		var capturedPath string
		var capturedQuery string

		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			capturedMethod = r.Method
			capturedPath = r.URL.Path
			capturedQuery = r.URL.RawQuery
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

		args := []string{"--path", input.PagePath}
		_ = Get(c, args)

		if capturedMethod != http.MethodGet {
			t.Logf("expected GET, got %s", capturedMethod)
			return false
		}
		if capturedPath != "/api/pages/by-path" {
			t.Logf("expected /api/pages/by-path, got %s", capturedPath)
			return false
		}

		// Verify the query parameter contains the correct path value
		expectedParam := "path=" + url.QueryEscape(input.PagePath)
		if !strings.Contains(capturedQuery, expectedParam) {
			t.Logf("expected query to contain %s, got %s", expectedParam, capturedQuery)
			return false
		}
		return true
	}, cfg)

	if err != nil {
		t.Errorf("Property 2 (--path routing) failed: %v", err)
	}
}

// TestGetBothIDTakesPrecedence verifies that when both --id and --path are
// provided, the command routes to GET /api/pages/<id> (id takes precedence).
func TestGetBothIDTakesPrecedence(t *testing.T) {
	cfg := &quick.Config{MaxCount: 100}

	err := quick.Check(func(input getBothInput) bool {
		var capturedMethod string
		var capturedPath string

		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			capturedMethod = r.Method
			capturedPath = r.URL.Path
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

		args := []string{"--id", fmt.Sprintf("%d", input.PageID), "--path", input.PagePath}
		_ = Get(c, args)

		expectedPath := fmt.Sprintf("/api/pages/%d", input.PageID)

		if capturedMethod != http.MethodGet {
			t.Logf("expected GET, got %s", capturedMethod)
			return false
		}
		if capturedPath != expectedPath {
			t.Logf("expected %s (id precedence), got %s", expectedPath, capturedPath)
			return false
		}
		return true
	}, cfg)

	if err != nil {
		t.Errorf("Property 2 (both --id and --path, id precedence) failed: %v", err)
	}
}
