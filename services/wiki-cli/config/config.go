package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Config holds the CLI configuration loaded from environment variables.
type Config struct {
	GatewayURL     string
	APIKey         string
	EnableWriteOps bool
}

// Load reads configuration from environment variables and returns a validated Config.
// It returns an error if required variables are missing or values are invalid.
func Load() (*Config, error) {
	apiKey := os.Getenv("WIKI_GATEWAY_API_KEY")
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("WIKI_GATEWAY_API_KEY environment variable is required")
	}

	gatewayURL := os.Getenv("WIKI_GATEWAY_URL")
	if gatewayURL == "" {
		gatewayURL = "http://localhost:3001"
	}

	parsed, err := url.Parse(gatewayURL)
	if err != nil || parsed.Scheme == "" {
		return nil, fmt.Errorf("WIKI_GATEWAY_URL is not a valid URL: %s", gatewayURL)
	}

	enableWriteOps := false
	writeOpsVal := os.Getenv("ENABLE_WRITE_OPS")
	if writeOpsVal == "true" || writeOpsVal == "1" {
		enableWriteOps = true
	}

	return &Config{
		GatewayURL:     gatewayURL,
		APIKey:         apiKey,
		EnableWriteOps: enableWriteOps,
	}, nil
}
