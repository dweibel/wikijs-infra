package commands

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"wiki-cli/client"
)

// Search executes the search command: sends a semantic search query to the gateway.
func Search(c *client.Client, args []string) error {
	fs := flag.NewFlagSet("search", flag.ContinueOnError)
	top := fs.Int("top", 5, "maximum number of results to return")

	// Suppress default usage output from FlagSet
	fs.SetOutput(os.Stderr)

	if err := fs.Parse(args); err != nil {
		return err
	}

	query := strings.Join(fs.Args(), " ")
	query = strings.TrimSpace(query)

	if query == "" {
		WriteUserError("search query is required", "search")
		return fmt.Errorf("missing search query")
	}

	result, err := c.Search(query, *top)
	if err != nil {
		WriteGatewayError(err)
		return err
	}

	WriteJSON(result)
	return nil
}
