package config

import (
	"fmt"
	"math/rand"
	"os"
	"testing"
	"testing/quick"
)

// Feature: wiki-cli, Property 9: Configuration loading from environment
// Validates: Requirements 10.1, 10.2

// validScheme returns a random URL scheme for generating valid URLs.
func validScheme(r *rand.Rand) string {
	schemes := []string{"http", "https"}
	return schemes[r.Intn(len(schemes))]
}

// validHost generates a random hostname string (alphanumeric).
func validHost(r *rand.Rand) string {
	length := r.Intn(10) + 3 // 3-12 chars
	chars := []byte("abcdefghijklmnopqrstuvwxyz0123456789")
	host := make([]byte, length)
	for i := range host {
		host[i] = chars[r.Intn(len(chars))]
	}
	return string(host)
}

// validPort generates a random port number string.
func validPort(r *rand.Rand) string {
	port := r.Intn(65535) + 1
	return fmt.Sprintf("%d", port)
}

// validAPIKey generates a random non-empty API key string.
func validAPIKey(r *rand.Rand) string {
	length := r.Intn(50) + 1 // 1-50 chars
	chars := []byte("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
	key := make([]byte, length)
	for i := range key {
		key[i] = chars[r.Intn(len(chars))]
	}
	return string(key)
}

// TestProperty9_ConfigLoadsFromEnvironment verifies that for any valid URL and
// non-empty API key set as environment variables, Load() produces a Config with
// those exact values.
func TestProperty9_ConfigLoadsFromEnvironment(t *testing.T) {
	cfg := &quick.Config{MaxCount: 100}

	f := func(seed int64) bool {
		r := rand.New(rand.NewSource(seed))

		url := fmt.Sprintf("%s://%s:%s", validScheme(r), validHost(r), validPort(r))
		apiKey := validAPIKey(r)

		os.Setenv("WIKI_GATEWAY_URL", url)
		os.Setenv("WIKI_GATEWAY_API_KEY", apiKey)
		os.Unsetenv("ENABLE_WRITE_OPS")
		defer func() {
			os.Unsetenv("WIKI_GATEWAY_URL")
			os.Unsetenv("WIKI_GATEWAY_API_KEY")
		}()

		c, err := Load()
		if err != nil {
			t.Logf("unexpected error for URL=%q, APIKey=%q: %v", url, apiKey, err)
			return false
		}
		if c.GatewayURL != url {
			t.Logf("GatewayURL mismatch: got %q, want %q", c.GatewayURL, url)
			return false
		}
		if c.APIKey != apiKey {
			t.Logf("APIKey mismatch: got %q, want %q", c.APIKey, apiKey)
			return false
		}
		return true
	}

	if err := quick.Check(f, cfg); err != nil {
		t.Errorf("Property 9 (config loads from env) failed: %v", err)
	}
}

// TestProperty9_EnableWriteOpsParsing verifies that ENABLE_WRITE_OPS is parsed
// correctly: "true" and "1" → true, all other values → false.
func TestProperty9_EnableWriteOpsParsing(t *testing.T) {
	os.Setenv("WIKI_GATEWAY_API_KEY", "test-key")
	defer os.Unsetenv("WIKI_GATEWAY_API_KEY")

	// "true" and "1" should enable write ops
	trueValues := []string{"true", "1"}
	for _, val := range trueValues {
		os.Setenv("ENABLE_WRITE_OPS", val)
		c, err := Load()
		if err != nil {
			t.Fatalf("unexpected error for ENABLE_WRITE_OPS=%q: %v", val, err)
		}
		if !c.EnableWriteOps {
			t.Errorf("ENABLE_WRITE_OPS=%q: expected EnableWriteOps=true, got false", val)
		}
	}

	// Property-based: any other string should result in false
	cfg := &quick.Config{MaxCount: 100}

	f := func(seed int64) bool {
		r := rand.New(rand.NewSource(seed))

		// Generate a random string that is NOT "true" or "1"
		length := r.Intn(20) + 1
		chars := []byte("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0234567890 -_FALSEfalseTrueTRUEyesno")
		val := make([]byte, length)
		for i := range val {
			val[i] = chars[r.Intn(len(chars))]
		}
		s := string(val)
		if s == "true" || s == "1" {
			return true // skip, already tested above
		}

		os.Setenv("ENABLE_WRITE_OPS", s)
		c, err := Load()
		if err != nil {
			t.Logf("unexpected error for ENABLE_WRITE_OPS=%q: %v", s, err)
			return false
		}
		if c.EnableWriteOps {
			t.Logf("ENABLE_WRITE_OPS=%q: expected EnableWriteOps=false, got true", s)
			return false
		}
		return true
	}

	if err := quick.Check(f, cfg); err != nil {
		t.Errorf("Property 9 (ENABLE_WRITE_OPS parsing) failed: %v", err)
	}

	os.Unsetenv("ENABLE_WRITE_OPS")
}

// TestProperty9_DefaultGatewayURL verifies that when WIKI_GATEWAY_URL is unset,
// Load() defaults GatewayURL to "http://localhost:3001".
func TestProperty9_DefaultGatewayURL(t *testing.T) {
	os.Unsetenv("WIKI_GATEWAY_URL")
	os.Setenv("WIKI_GATEWAY_API_KEY", "test-key")
	defer os.Unsetenv("WIKI_GATEWAY_API_KEY")

	c, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.GatewayURL != "http://localhost:3001" {
		t.Errorf("default GatewayURL: got %q, want %q", c.GatewayURL, "http://localhost:3001")
	}
}

// Feature: wiki-cli, Property 10: Invalid URL rejection
// Validates: Requirements 10.5

// noSchemeString generates a random string that Go's url.Parse will consider
// to have no scheme. We avoid colons entirely so that url.Parse cannot extract
// any scheme component from the string.
func noSchemeString(r *rand.Rand) string {
	// Characters that exclude ':' so url.Parse cannot find a scheme
	chars := []byte("abcdefghijklmnopqrstuvwxyz0123456789 !@#$%^&*()_+-=[]{}|;',.<>?/")
	length := r.Intn(30) + 1 // 1-30 chars
	s := make([]byte, length)
	for i := range s {
		s[i] = chars[r.Intn(len(chars))]
	}
	return string(s)
}

// TestProperty10_InvalidURLRejection verifies that for any string without a URL
// scheme, Load() returns an error when that string is set as WIKI_GATEWAY_URL.
func TestProperty10_InvalidURLRejection(t *testing.T) {
	cfg := &quick.Config{MaxCount: 100}

	f := func(seed int64) bool {
		r := rand.New(rand.NewSource(seed))

		invalidURL := noSchemeString(r)
		apiKey := validAPIKey(r)

		os.Setenv("WIKI_GATEWAY_URL", invalidURL)
		os.Setenv("WIKI_GATEWAY_API_KEY", apiKey)
		defer func() {
			os.Unsetenv("WIKI_GATEWAY_URL")
			os.Unsetenv("WIKI_GATEWAY_API_KEY")
		}()

		_, err := Load()
		if err == nil {
			t.Logf("expected error for invalid URL %q but got nil", invalidURL)
			return false
		}
		return true
	}

	if err := quick.Check(f, cfg); err != nil {
		t.Errorf("Property 10 (invalid URL rejection) failed: %v", err)
	}
}

// Unit tests for config edge cases (Task 2.4)
// Validates: Requirements 10.4

// TestUnit_MissingAPIKey verifies that when WIKI_GATEWAY_API_KEY is not set,
// Load() returns an error with a descriptive message mentioning the variable name.
func TestUnit_MissingAPIKey(t *testing.T) {
	os.Unsetenv("WIKI_GATEWAY_API_KEY")
	os.Unsetenv("WIKI_GATEWAY_URL")
	os.Unsetenv("ENABLE_WRITE_OPS")

	cfg, err := Load()
	if cfg != nil {
		t.Errorf("expected nil config when API key is missing, got %+v", cfg)
	}
	if err == nil {
		t.Fatal("expected error when WIKI_GATEWAY_API_KEY is not set, got nil")
	}
	errMsg := err.Error()
	if !contains(errMsg, "WIKI_GATEWAY_API_KEY") {
		t.Errorf("error message should mention WIKI_GATEWAY_API_KEY, got: %q", errMsg)
	}
}

// TestUnit_EmptyAPIKey verifies that when WIKI_GATEWAY_API_KEY is set to an
// empty string, Load() returns an error.
func TestUnit_EmptyAPIKey(t *testing.T) {
	os.Setenv("WIKI_GATEWAY_API_KEY", "")
	os.Unsetenv("WIKI_GATEWAY_URL")
	os.Unsetenv("ENABLE_WRITE_OPS")
	defer os.Unsetenv("WIKI_GATEWAY_API_KEY")

	cfg, err := Load()
	if cfg != nil {
		t.Errorf("expected nil config when API key is empty, got %+v", cfg)
	}
	if err == nil {
		t.Fatal("expected error when WIKI_GATEWAY_API_KEY is empty string, got nil")
	}
	errMsg := err.Error()
	if !contains(errMsg, "WIKI_GATEWAY_API_KEY") {
		t.Errorf("error message should mention WIKI_GATEWAY_API_KEY, got: %q", errMsg)
	}
}

// TestUnit_ValidConfigAllEnvVars verifies that when all environment variables
// are set to valid values, Load() returns a correctly populated Config.
func TestUnit_ValidConfigAllEnvVars(t *testing.T) {
	os.Setenv("WIKI_GATEWAY_URL", "https://wiki.example.com:8080")
	os.Setenv("WIKI_GATEWAY_API_KEY", "my-secret-key-123")
	os.Setenv("ENABLE_WRITE_OPS", "true")
	defer func() {
		os.Unsetenv("WIKI_GATEWAY_URL")
		os.Unsetenv("WIKI_GATEWAY_API_KEY")
		os.Unsetenv("ENABLE_WRITE_OPS")
	}()

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error with valid env vars: %v", err)
	}
	if cfg.GatewayURL != "https://wiki.example.com:8080" {
		t.Errorf("GatewayURL: got %q, want %q", cfg.GatewayURL, "https://wiki.example.com:8080")
	}
	if cfg.APIKey != "my-secret-key-123" {
		t.Errorf("APIKey: got %q, want %q", cfg.APIKey, "my-secret-key-123")
	}
	if !cfg.EnableWriteOps {
		t.Error("EnableWriteOps: got false, want true")
	}
}

// contains checks if substr is present in s.
func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
