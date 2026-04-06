package commands

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"wiki-cli/client"
)

// Move executes the move command: moves a page to a new path via the gateway.
func Move(c *client.Client, args []string, writeEnabled bool) error {
	if !writeEnabled {
		fmt.Fprintln(os.Stderr, "Error: write operations are disabled. Set ENABLE_WRITE_OPS=true to enable.")
		fmt.Fprintln(os.Stderr, "Run 'wiki-cli help move' for usage details")
		return fmt.Errorf("write operations disabled")
	}

	fs := flag.NewFlagSet("move", flag.ContinueOnError)
	id := fs.Int("id", 0, "page ID (int, required)")
	destination := fs.String("destination", "", "destination path (string, required)")
	locale := fs.String("locale", "", "destination locale (string, optional)")

	// Suppress default usage output from FlagSet
	fs.SetOutput(os.Stderr)

	if err := fs.Parse(args); err != nil {
		return err
	}

	// Validate required flags
	var missing []string
	if *id == 0 {
		missing = append(missing, "--id")
	}
	if *destination == "" {
		missing = append(missing, "--destination")
	}
	if len(missing) > 0 {
		WriteUserError(fmt.Sprintf("missing required flags: %s", strings.Join(missing, ", ")), "move")
		return fmt.Errorf("missing required flags: %s", strings.Join(missing, ", "))
	}

	result, err := c.MovePage(*id, *destination, *locale)
	if err != nil {
		WriteGatewayError(err)
		return err
	}

	WriteJSON(result)
	return nil
}
