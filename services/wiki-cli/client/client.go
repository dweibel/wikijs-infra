package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Client communicates with the Wiki REST API Gateway over HTTP.
type Client struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

// GatewayError represents an error response from the gateway.
type GatewayError struct {
	Message    string
	StatusCode int
	Body       string
}

func (e *GatewayError) Error() string {
	return fmt.Sprintf("gateway error (HTTP %d): %s", e.StatusCode, e.Message)
}

// Request types

// SearchRequest is the JSON body for the search endpoint.
type SearchRequest struct {
	Query string `json:"query"`
	TopK  int    `json:"top_k,omitempty"`
}

// CreatePageRequest is the JSON body for creating a page.
type CreatePageRequest struct {
	Title       string   `json:"title"`
	Path        string   `json:"path"`
	Content     string   `json:"content"`
	Description string   `json:"description,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

// UpdatePageRequest is the JSON body for updating a page.
type UpdatePageRequest struct {
	Title       *string  `json:"title,omitempty"`
	Content     *string  `json:"content,omitempty"`
	Description *string  `json:"description,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

// MovePageRequest is the JSON body for moving a page.
type MovePageRequest struct {
	DestinationPath   string `json:"destination_path"`
	DestinationLocale string `json:"destination_locale,omitempty"`
}

// New creates a new Client with a 30-second HTTP timeout.
func New(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: baseURL,
		APIKey:  apiKey,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// do executes an HTTP request with retry logic.
// Retries up to 3 attempts with 100ms/200ms backoff on 5xx and network errors.
// No retry on 4xx.
func (c *Client) do(method, path string, body []byte) ([]byte, error) {
	backoffs := []time.Duration{100 * time.Millisecond, 200 * time.Millisecond}
	maxAttempts := 3

	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(backoffs[attempt-1])
		}

		reqURL := c.BaseURL + path

		var reqBody io.Reader
		if body != nil {
			reqBody = bytes.NewReader(body)
		}

		req, err := http.NewRequest(method, reqURL, reqBody)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}

		req.Header.Set("Authorization", "Bearer "+c.APIKey)
		req.Header.Set("Content-Type", "application/json")

		resp, err := c.HTTPClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("network error: %w", err)
			continue // retry on network errors
		}

		respBody, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("failed to read response body: %w", err)
			continue
		}

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return respBody, nil
		}

		// No retry on 4xx
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return nil, &GatewayError{
				Message:    http.StatusText(resp.StatusCode),
				StatusCode: resp.StatusCode,
				Body:       string(respBody),
			}
		}

		// 5xx — retry
		lastErr = &GatewayError{
			Message:    http.StatusText(resp.StatusCode),
			StatusCode: resp.StatusCode,
			Body:       string(respBody),
		}
	}

	return nil, lastErr
}

// Read operations

// Search sends a semantic search request to the gateway.
func (c *Client) Search(query string, topK int) ([]byte, error) {
	payload := SearchRequest{Query: query, TopK: topK}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal search request: %w", err)
	}
	return c.do(http.MethodPost, "/api/search", body)
}

// GetPage fetches a page by numeric ID.
func (c *Client) GetPage(pageID int) ([]byte, error) {
	path := fmt.Sprintf("/api/pages/%d", pageID)
	return c.do(http.MethodGet, path, nil)
}

// GetPageByPath fetches a page by its path.
func (c *Client) GetPageByPath(pagePath string) ([]byte, error) {
	path := "/api/pages/by-path?path=" + url.QueryEscape(pagePath)
	return c.do(http.MethodGet, path, nil)
}

// ListPages fetches all pages.
func (c *Client) ListPages() ([]byte, error) {
	return c.do(http.MethodGet, "/api/pages", nil)
}

// Write operations

// CreatePage creates a new page.
func (c *Client) CreatePage(data CreatePageRequest) ([]byte, error) {
	body, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal create request: %w", err)
	}
	return c.do(http.MethodPost, "/api/pages", body)
}

// UpdatePage updates an existing page by ID.
func (c *Client) UpdatePage(pageID int, data UpdatePageRequest) ([]byte, error) {
	body, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal update request: %w", err)
	}
	path := fmt.Sprintf("/api/pages/%d", pageID)
	return c.do(http.MethodPut, path, body)
}

// DeletePage deletes a page by ID.
func (c *Client) DeletePage(pageID int) ([]byte, error) {
	path := fmt.Sprintf("/api/pages/%d", pageID)
	return c.do(http.MethodDelete, path, nil)
}

// MovePage moves a page to a new path.
func (c *Client) MovePage(pageID int, destPath string, locale string) ([]byte, error) {
	payload := MovePageRequest{
		DestinationPath:   destPath,
		DestinationLocale: locale,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal move request: %w", err)
	}
	path := fmt.Sprintf("/api/pages/%d/move", pageID)
	return c.do(http.MethodPost, path, body)
}
