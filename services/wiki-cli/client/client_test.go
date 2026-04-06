package client

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// --- Helpers ---

// newTestClient creates a Client pointing at the given httptest server.
func newTestClient(ts *httptest.Server) *Client {
	return &Client{
		BaseURL:    ts.URL,
		APIKey:     "test-api-key",
		HTTPClient: ts.Client(),
	}
}

// requestLog captures details of an incoming request for assertions.
type requestLog struct {
	Method string
	Path   string
	Header http.Header
	Body   string
}

// captureHandler records the request and responds with the given status and body.
func captureHandler(status int, respBody string, log *requestLog) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bodyBytes, _ := io.ReadAll(r.Body)
		*log = requestLog{
			Method: r.Method,
			Path:   r.URL.RequestURI(),
			Header: r.Header.Clone(),
			Body:   string(bodyBytes),
		}
		w.WriteHeader(status)
		fmt.Fprint(w, respBody)
	}
}

// --- Test: correct HTTP method, path, and headers for each endpoint ---

func TestSearch_MethodPathHeaders(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `{"results":[]}`, &got))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.Search("test query", 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Method != "POST" {
		t.Errorf("method = %q, want POST", got.Method)
	}
	if got.Path != "/api/search" {
		t.Errorf("path = %q, want /api/search", got.Path)
	}
}

func TestGetPage_MethodPathHeaders(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `{"id":42}`, &got))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.GetPage(42)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Method != "GET" {
		t.Errorf("method = %q, want GET", got.Method)
	}
	if got.Path != "/api/pages/42" {
		t.Errorf("path = %q, want /api/pages/42", got.Path)
	}
}

func TestGetPageByPath_MethodPathHeaders(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `{"id":1}`, &got))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.GetPageByPath("docs/intro")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Method != "GET" {
		t.Errorf("method = %q, want GET", got.Method)
	}
	want := "/api/pages/by-path?path=docs%2Fintro"
	if got.Path != want {
		t.Errorf("path = %q, want %q", got.Path, want)
	}
}

func TestListPages_MethodPathHeaders(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `[]`, &got))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.ListPages()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Method != "GET" {
		t.Errorf("method = %q, want GET", got.Method)
	}
	if got.Path != "/api/pages" {
		t.Errorf("path = %q, want /api/pages", got.Path)
	}
}

func TestCreatePage_MethodPathHeaders(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `{"id":99}`, &got))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.CreatePage(CreatePageRequest{
		Title:   "Test",
		Path:    "test-page",
		Content: "Hello",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Method != "POST" {
		t.Errorf("method = %q, want POST", got.Method)
	}
	if got.Path != "/api/pages" {
		t.Errorf("path = %q, want /api/pages", got.Path)
	}
}

func TestUpdatePage_MethodPathHeaders(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `{"id":7}`, &got))
	defer ts.Close()
	c := newTestClient(ts)

	title := "Updated"
	_, err := c.UpdatePage(7, UpdatePageRequest{Title: &title})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Method != "PUT" {
		t.Errorf("method = %q, want PUT", got.Method)
	}
	if got.Path != "/api/pages/7" {
		t.Errorf("path = %q, want /api/pages/7", got.Path)
	}
}

func TestDeletePage_MethodPathHeaders(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `{}`, &got))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.DeletePage(10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Method != "DELETE" {
		t.Errorf("method = %q, want DELETE", got.Method)
	}
	if got.Path != "/api/pages/10" {
		t.Errorf("path = %q, want /api/pages/10", got.Path)
	}
}

func TestMovePage_MethodPathHeaders(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `{}`, &got))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.MovePage(5, "/new/path", "en")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Method != "POST" {
		t.Errorf("method = %q, want POST", got.Method)
	}
	if got.Path != "/api/pages/5/move" {
		t.Errorf("path = %q, want /api/pages/5/move", got.Path)
	}
}

// --- Test: Bearer token in Authorization header ---

func TestBearerToken_SentInAuthorizationHeader(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `{}`, &got))
	defer ts.Close()

	c := &Client{
		BaseURL:    ts.URL,
		APIKey:     "my-secret-key",
		HTTPClient: ts.Client(),
	}

	_, err := c.ListPages()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	authHeader := got.Header.Get("Authorization")
	if authHeader != "Bearer my-secret-key" {
		t.Errorf("Authorization = %q, want %q", authHeader, "Bearer my-secret-key")
	}

	ct := got.Header.Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}
}

// --- Test: retry on 5xx ---

func TestRetryOn5xx_SucceedsAfterTransientFailures(t *testing.T) {
	var attempts int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&attempts, 1)
		if n <= 2 {
			w.WriteHeader(http.StatusInternalServerError)
			fmt.Fprint(w, `{"error":"server error"}`)
			return
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `{"ok":true}`)
	}))
	defer ts.Close()
	c := newTestClient(ts)

	body, err := c.ListPages()
	if err != nil {
		t.Fatalf("expected success after retries, got error: %v", err)
	}
	if string(body) != `{"ok":true}` {
		t.Errorf("body = %q, want %q", string(body), `{"ok":true}`)
	}
	if atomic.LoadInt32(&attempts) != 3 {
		t.Errorf("attempts = %d, want 3", atomic.LoadInt32(&attempts))
	}
}

// --- Test: no retry on 4xx ---

func TestNoRetryOn4xx_ImmediateError(t *testing.T) {
	var attempts int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&attempts, 1)
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprint(w, `{"error":"not found"}`)
	}))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.GetPage(999)
	if err == nil {
		t.Fatal("expected error for 404, got nil")
	}
	if atomic.LoadInt32(&attempts) != 1 {
		t.Errorf("attempts = %d, want 1 (no retry on 4xx)", atomic.LoadInt32(&attempts))
	}
}

// --- Test: network error handling ---

func TestNetworkError_ConnectionRefused(t *testing.T) {
	// Create a server and immediately close it to get a port that refuses connections.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	closedURL := ts.URL
	ts.Close()

	c := &Client{
		BaseURL:    closedURL,
		APIKey:     "key",
		HTTPClient: &http.Client{},
	}

	_, err := c.ListPages()
	if err == nil {
		t.Fatal("expected network error, got nil")
	}
	if !strings.Contains(err.Error(), "network error") {
		t.Errorf("error = %q, want it to contain 'network error'", err.Error())
	}
}

// --- Test: GatewayError struct populated correctly ---

func TestGatewayError_PopulatedCorrectly(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprint(w, `{"error":"access denied"}`)
	}))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.ListPages()
	if err == nil {
		t.Fatal("expected GatewayError, got nil")
	}

	ge, ok := err.(*GatewayError)
	if !ok {
		t.Fatalf("expected *GatewayError, got %T", err)
	}
	if ge.StatusCode != 403 {
		t.Errorf("StatusCode = %d, want 403", ge.StatusCode)
	}
	if ge.Body != `{"error":"access denied"}` {
		t.Errorf("Body = %q, want %q", ge.Body, `{"error":"access denied"}`)
	}
	if ge.Message != "Forbidden" {
		t.Errorf("Message = %q, want %q", ge.Message, "Forbidden")
	}
}

func TestGatewayError_ErrorStringFormat(t *testing.T) {
	ge := &GatewayError{
		Message:    "Not Found",
		StatusCode: 404,
		Body:       `{"error":"page not found"}`,
	}
	want := "gateway error (HTTP 404): Not Found"
	if ge.Error() != want {
		t.Errorf("Error() = %q, want %q", ge.Error(), want)
	}
}

func TestGatewayError_5xxAfterAllRetries(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		fmt.Fprint(w, `bad gateway`)
	}))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.ListPages()
	if err == nil {
		t.Fatal("expected GatewayError after exhausting retries, got nil")
	}
	ge, ok := err.(*GatewayError)
	if !ok {
		t.Fatalf("expected *GatewayError, got %T", err)
	}
	if ge.StatusCode != 502 {
		t.Errorf("StatusCode = %d, want 502", ge.StatusCode)
	}
}

// --- Test: request body serialization for POST/PUT ---

func TestSearch_RequestBodySerialization(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `{}`, &got))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.Search("hello world", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var sr SearchRequest
	if err := json.Unmarshal([]byte(got.Body), &sr); err != nil {
		t.Fatalf("failed to unmarshal request body: %v", err)
	}
	if sr.Query != "hello world" {
		t.Errorf("Query = %q, want %q", sr.Query, "hello world")
	}
	if sr.TopK != 10 {
		t.Errorf("TopK = %d, want 10", sr.TopK)
	}
}

func TestCreatePage_RequestBodySerialization(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `{}`, &got))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.CreatePage(CreatePageRequest{
		Title:       "My Page",
		Path:        "my-page",
		Content:     "# Hello",
		Description: "A test page",
		Tags:        []string{"go", "test"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var cr CreatePageRequest
	if err := json.Unmarshal([]byte(got.Body), &cr); err != nil {
		t.Fatalf("failed to unmarshal request body: %v", err)
	}
	if cr.Title != "My Page" {
		t.Errorf("Title = %q, want %q", cr.Title, "My Page")
	}
	if cr.Path != "my-page" {
		t.Errorf("Path = %q, want %q", cr.Path, "my-page")
	}
	if cr.Content != "# Hello" {
		t.Errorf("Content = %q, want %q", cr.Content, "# Hello")
	}
	if cr.Description != "A test page" {
		t.Errorf("Description = %q, want %q", cr.Description, "A test page")
	}
	if len(cr.Tags) != 2 || cr.Tags[0] != "go" || cr.Tags[1] != "test" {
		t.Errorf("Tags = %v, want [go test]", cr.Tags)
	}
}

func TestUpdatePage_RequestBodySerialization(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `{}`, &got))
	defer ts.Close()
	c := newTestClient(ts)

	title := "Updated Title"
	content := "New content"
	_, err := c.UpdatePage(42, UpdatePageRequest{
		Title:   &title,
		Content: &content,
		Tags:    []string{"updated"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var ur UpdatePageRequest
	if err := json.Unmarshal([]byte(got.Body), &ur); err != nil {
		t.Fatalf("failed to unmarshal request body: %v", err)
	}
	if ur.Title == nil || *ur.Title != "Updated Title" {
		t.Errorf("Title = %v, want %q", ur.Title, "Updated Title")
	}
	if ur.Content == nil || *ur.Content != "New content" {
		t.Errorf("Content = %v, want %q", ur.Content, "New content")
	}
	if ur.Description != nil {
		t.Errorf("Description = %v, want nil (omitted)", ur.Description)
	}
	if len(ur.Tags) != 1 || ur.Tags[0] != "updated" {
		t.Errorf("Tags = %v, want [updated]", ur.Tags)
	}
}

func TestMovePage_RequestBodySerialization(t *testing.T) {
	var got requestLog
	ts := httptest.NewServer(captureHandler(200, `{}`, &got))
	defer ts.Close()
	c := newTestClient(ts)

	_, err := c.MovePage(3, "/new/location", "fr")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var mr MovePageRequest
	if err := json.Unmarshal([]byte(got.Body), &mr); err != nil {
		t.Fatalf("failed to unmarshal request body: %v", err)
	}
	if mr.DestinationPath != "/new/location" {
		t.Errorf("DestinationPath = %q, want %q", mr.DestinationPath, "/new/location")
	}
	if mr.DestinationLocale != "fr" {
		t.Errorf("DestinationLocale = %q, want %q", mr.DestinationLocale, "fr")
	}
}
