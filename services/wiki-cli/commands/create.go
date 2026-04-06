package commands

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"wiki-cli/client"
)

// Create executes the create command: creates a new page via the gateway.
func Create(c *client.Client, args []string, writeEnabled bool) error {
	if !writeEnabled {
		fmt.Fprintln(os.Stderr, "Error: write operations are disabled. Set ENABLE_WRITE_OPS=true to enable.")
		fmt.Fprintln(os.Stderr, "Run 'wiki-cli help create' for usage details")
		return fmt.Errorf("write operations disabled")
	}

	fs := flag.NewFlagSet("create", flag.ContinueOnError)
	title := fs.String("title", "", "page title (string, required)")
	path := fs.String("path", "", "page path (string, required)")
	content := fs.String("content", "", "page content (string, required)")
	description := fs.String("description", "", "page description (string, optional)")
	tags := fs.String("tags", "", "comma-separated tags (string, optional)")

	// Suppress default usage output from FlagSet
	fs.SetOutput(os.Stderr)

	if err := fs.Parse(args); err != nil {
		return err
	}

	// Validate required flags
	var missing []string
	if *title == "" {
		missing = append(missing, "--title")
	}
	if *path == "" {
		missing = append(missing, "--path")
	}
	if *content == "" {
		missing = append(missing, "--content")
	}
	if len(missing) > 0 {
		WriteUserError(fmt.Sprintf("missing required flags: %s", strings.Join(missing, ", ")), "create")
		return fmt.Errorf("missing required flags: %s", strings.Join(missing, ", "))
	}

	data := client.CreatePageRequest{
		Title:       *title,
		Path:        *path,
		Content:     *content,
		Description: *description,
	}

	if *tags != "" {
		parts := strings.Split(*tags, ",")
		trimmed := make([]string, 0, len(parts))
		for _, t := range parts {
			t = strings.TrimSpace(t)
			if t != "" {
				trimmed = append(trimmed, t)
			}
		}
		data.Tags = trimmed
	}

	result, err := c.CreatePage(data)
	if err != nil {
		WriteGatewayError(err)
		return err
	}

	WriteJSON(result)
	return nil
}
