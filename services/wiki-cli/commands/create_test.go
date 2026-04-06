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

// Feature: wiki-cli, Property 3: Create request construction
// **Validates: Requirements 5.1, 5.2**

// createInput holds generated test inputs for the create property test.
type createInput struct {
	Title       string
	Path        string
	Content     string
	Description string // empty means omitted
	Tags        []string
}

// randAlphanumeric generates a non-empty alphanumeric string of length [1, size].
func randAlphanumeric(r *rand.Rand, size int) string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	length := r.Intn(size+1) + 1
	buf := make([]byte, length)
	for i := range buf {
		buf[i] = chars[r.Intn(len(chars))]
	}
	return string(buf)
}

// Generate implements quick.Generator for createInput.
func (createInput) Generate(r *rand.Rand, size int) reflect.Value {
	title := randAlphanumeric(r, size)
	path := randAlphanumeric(r, size)
	content := randAlphanumeric(r, size)

	// Optionally generate description (50% chance)
	var description string
	if r.Intn(2) == 1 {
		description = randAlphanumeric(r, size)
	}

	// Optionally generate tags (50% chance, 1-3 tags)
	var tags []string
	if r.Intn(2) == 1 {
		numTags := r.Intn(3) + 1
		tags = make([]string, numTags)
		for i := range tags {
			tags[i] = randAlphanumeric(r, size)
		}
	}

	return reflect.ValueOf(createInput{
		Title:       title,
		Path:        path,
		Content:     content,
		Description: description,
		Tags:        tags,
	})
}

func TestCreateRequestConstruction(t *testing.T) {
	cfg := &quick.Config{MaxCount: 100}

	err := quick.Check(func(input createInput) bool {
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
			"--title", input.Title,
			"--path", input.Path,
			"--content", input.Content,
		}
		if input.Description != "" {
			args = append(args, "--description", input.Description)
		}
		if len(input.Tags) > 0 {
			tagsStr := ""
			for i, tag := range input.Tags {
				if i > 0 {
					tagsStr += ","
				}
				tagsStr += tag
			}
			args = append(args, "--tags", tagsStr)
		}

		err := Create(c, args, true)
		if err != nil {
			t.Logf("Create returned error: %v", err)
			return false
		}

		// Verify HTTP method is POST
		if capturedMethod != http.MethodPost {
			t.Logf("expected POST, got %s", capturedMethod)
			return false
		}

		// Verify path is /api/pages
		if capturedPath != "/api/pages" {
			t.Logf("expected /api/pages, got %s", capturedPath)
			return false
		}

		// Verify JSON body has correct fields
		var body client.CreatePageRequest
		if err := json.Unmarshal(capturedBody, &body); err != nil {
			t.Logf("failed to unmarshal request body: %v", err)
			return false
		}

		if body.Title != input.Title {
			t.Logf("expected title %q, got %q", input.Title, body.Title)
			return false
		}

		if body.Path != input.Path {
			t.Logf("expected path %q, got %q", input.Path, body.Path)
			return false
		}

		if body.Content != input.Content {
			t.Logf("expected content %q, got %q", input.Content, body.Content)
			return false
		}

		if body.Description != input.Description {
			t.Logf("expected description %q, got %q", input.Description, body.Description)
			return false
		}

		// Verify tags
		if len(input.Tags) == 0 {
			if len(body.Tags) != 0 {
				t.Logf("expected no tags, got %v", body.Tags)
				return false
			}
		} else {
			if len(body.Tags) != len(input.Tags) {
				t.Logf("expected %d tags, got %d", len(input.Tags), len(body.Tags))
				return false
			}
			for i, tag := range input.Tags {
				if body.Tags[i] != tag {
					t.Logf("expected tag[%d] %q, got %q", i, tag, body.Tags[i])
					return false
				}
			}
		}

		return true
	}, cfg)

	if err != nil {
		t.Errorf("Property 3 failed: %v", err)
	}
}
