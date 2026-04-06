package commands

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"wiki-cli/client"
)

// Update executes the update command: updates an existing page via the gateway.
func Update(c *client.Client, args []string, writeEnabled bool) error {
	if !writeEnabled {
		fmt.Fprintln(os.Stderr, "Error: write operations are disabled. Set ENABLE_WRITE_OPS=true to enable.")
		fmt.Fprintln(os.Stderr, "Run 'wiki-cli help update' for usage details")
		return fmt.Errorf("write operations disabled")
	}

	fs := flag.NewFlagSet("update", flag.ContinueOnError)
	id := fs.Int("id", 0, "page ID (int, required)")
	title := fs.String("title", "", "new page title (string, optional)")
	content := fs.String("content", "", "new page content (string, optional)")
	description := fs.String("description", "", "new page description (string, optional)")
	tags := fs.String("tags", "", "comma-separated tags (string, optional)")

	// Suppress default usage output from FlagSet
	fs.SetOutput(os.Stderr)

	if err := fs.Parse(args); err != nil {
		return err
	}

	// Validate required --id flag
	if *id == 0 {
		WriteUserError("missing required flag: --id", "update")
		return fmt.Errorf("missing required flag: --id")
	}

	// Track which flags were explicitly provided
	provided := make(map[string]bool)
	fs.Visit(func(f *flag.Flag) {
		provided[f.Name] = true
	})

	// Build UpdatePageRequest with only provided fields
	data := client.UpdatePageRequest{}

	if provided["title"] {
		data.Title = title
	}
	if provided["content"] {
		data.Content = content
	}
	if provided["description"] {
		data.Description = description
	}
	if provided["tags"] {
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

	result, err := c.UpdatePage(*id, data)
	if err != nil {
		WriteGatewayError(err)
		return err
	}

	WriteJSON(result)
	return nil
}
