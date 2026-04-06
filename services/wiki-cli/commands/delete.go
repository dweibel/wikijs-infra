package commands

import (
	"flag"
	"fmt"
	"os"

	"wiki-cli/client"
)

// Delete executes the delete command: deletes a page via the gateway.
func Delete(c *client.Client, args []string, writeEnabled bool) error {
	if !writeEnabled {
		fmt.Fprintln(os.Stderr, "Error: write operations are disabled. Set ENABLE_WRITE_OPS=true to enable.")
		fmt.Fprintln(os.Stderr, "Run 'wiki-cli help delete' for usage details")
		return fmt.Errorf("write operations disabled")
	}

	fs := flag.NewFlagSet("delete", flag.ContinueOnError)
	id := fs.Int("id", 0, "page ID (int, required)")

	// Suppress default usage output from FlagSet
	fs.SetOutput(os.Stderr)

	if err := fs.Parse(args); err != nil {
		return err
	}

	// Validate required --id flag
	if *id == 0 {
		WriteUserError("missing required flag: --id", "delete")
		return fmt.Errorf("missing required flag: --id")
	}

	result, err := c.DeletePage(*id)
	if err != nil {
		WriteGatewayError(err)
		return err
	}

	WriteJSON(result)
	return nil
}
