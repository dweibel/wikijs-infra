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

// Feature: wiki-cli, Property 4: Update request construction
// **Validates: Requirements 6.1**

// updateInput holds generated test inputs for the update property test.
type updateInput struct {
	PageID      int
	HasTitle    bool
	Title       string
	HasContent  bool
	Content     string
	HasDesc     bool
	Description string
	HasTags     bool
	Tags        []string
}

// Generate implements quick.Generator for updateInput.
func (updateInput) Generate(r *rand.Rand, size int) reflect.Value {
	pageID := r.Intn(10000) + 1 // positive int

	hasTitle := r.Intn(2) == 1
	hasContent := r.Intn(2) == 1
	hasDesc := r.Intn(2) == 1
	hasTags := r.Intn(2) == 1

	// Ensure at least one field is provided
	if !hasTitle && !hasContent && !hasDesc && !hasTags {
		switch r.Intn(4) {
		case 0:
			hasTitle = true
		case 1:
			hasContent = true
		case 2:
			hasDesc = true
		case 3:
			hasTags = true
		}
	}

	var title, content, desc string
	var tags []string

	if hasTitle {
		title = randAlphanumeric(r, size)
	}
	if hasContent {
		content = randAlphanumeric(r, size)
	}
	if hasDesc {
		desc = randAlphanumeric(r, size)
	}
	if hasTags {
		numTags := r.Intn(3) + 1
		tags = make([]string, numTags)
		for i := range tags {
			tags[i] = randAlphanumeric(r, size)
		}
	}

	return reflect.ValueOf(updateInput{
		PageID:      pageID,
		HasTitle:    hasTitle,
		Title:       title,
		HasContent:  hasContent,
		Content:     content,
		HasDesc:     hasDesc,
		Description: desc,
		HasTags:     hasTags,
		Tags:        tags,
	})
}

func TestUpdateRequestConstruction(t *testing.T) {
	cfg := &quick.Config{MaxCount: 100}

	err := quick.Check(func(input updateInput) bool {
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

		// Build args with --id and only the provided fields
		args := []string{"--id", fmt.Sprintf("%d", input.PageID)}
		if input.HasTitle {
			args = append(args, "--title", input.Title)
		}
		if input.HasContent {
			args = append(args, "--content", input.Content)
		}
		if input.HasDesc {
			args = append(args, "--description", input.Description)
		}
		if input.HasTags {
			tagsStr := ""
			for i, tag := range input.Tags {
				if i > 0 {
					tagsStr += ","
				}
				tagsStr += tag
			}
			args = append(args, "--tags", tagsStr)
		}

		err := Update(c, args, true)
		if err != nil {
			t.Logf("Update returned error: %v", err)
			return false
		}

		// Verify HTTP method is PUT
		if capturedMethod != http.MethodPut {
			t.Logf("expected PUT, got %s", capturedMethod)
			return false
		}

		// Verify path is /api/pages/<id>
		expectedPath := fmt.Sprintf("/api/pages/%d", input.PageID)
		if capturedPath != expectedPath {
			t.Logf("expected %s, got %s", expectedPath, capturedPath)
			return false
		}

		// Parse the JSON body as a raw map to check only provided fields exist
		var bodyMap map[string]interface{}
		if err := json.Unmarshal(capturedBody, &bodyMap); err != nil {
			t.Logf("failed to unmarshal request body: %v", err)
			return false
		}

		// Count expected fields
		expectedFields := 0
		if input.HasTitle {
			expectedFields++
		}
		if input.HasContent {
			expectedFields++
		}
		if input.HasDesc {
			expectedFields++
		}
		if input.HasTags {
			expectedFields++
		}

		if len(bodyMap) != expectedFields {
			t.Logf("expected %d fields in body, got %d: %v", expectedFields, len(bodyMap), bodyMap)
			return false
		}

		// Verify each provided field has the correct value
		if input.HasTitle {
			if v, ok := bodyMap["title"]; !ok {
				t.Logf("expected title field in body")
				return false
			} else if v.(string) != input.Title {
				t.Logf("expected title %q, got %q", input.Title, v)
				return false
			}
		} else {
			if _, ok := bodyMap["title"]; ok {
				t.Logf("title should not be in body when not provided")
				return false
			}
		}

		if input.HasContent {
			if v, ok := bodyMap["content"]; !ok {
				t.Logf("expected content field in body")
				return false
			} else if v.(string) != input.Content {
				t.Logf("expected content %q, got %q", input.Content, v)
				return false
			}
		} else {
			if _, ok := bodyMap["content"]; ok {
				t.Logf("content should not be in body when not provided")
				return false
			}
		}

		if input.HasDesc {
			if v, ok := bodyMap["description"]; !ok {
				t.Logf("expected description field in body")
				return false
			} else if v.(string) != input.Description {
				t.Logf("expected description %q, got %q", input.Description, v)
				return false
			}
		} else {
			if _, ok := bodyMap["description"]; ok {
				t.Logf("description should not be in body when not provided")
				return false
			}
		}

		if input.HasTags {
			rawTags, ok := bodyMap["tags"]
			if !ok {
				t.Logf("expected tags field in body")
				return false
			}
			tagsArr, ok := rawTags.([]interface{})
			if !ok {
				t.Logf("tags is not an array: %T", rawTags)
				return false
			}
			if len(tagsArr) != len(input.Tags) {
				t.Logf("expected %d tags, got %d", len(input.Tags), len(tagsArr))
				return false
			}
			for i, tag := range input.Tags {
				if tagsArr[i].(string) != tag {
					t.Logf("expected tag[%d] %q, got %q", i, tag, tagsArr[i])
					return false
				}
			}
		} else {
			if _, ok := bodyMap["tags"]; ok {
				t.Logf("tags should not be in body when not provided")
				return false
			}
		}

		return true
	}, cfg)

	if err != nil {
		t.Errorf("Property 4 failed: %v", err)
	}
}
