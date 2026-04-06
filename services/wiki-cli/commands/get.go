package commands

import (
	"flag"
	"fmt"
	"os"

	"wiki-cli/client"
)

// Get executes the get command: fetches a page by ID or path from the gateway.
func Get(c *client.Client, args []string) error {
	fs := flag.NewFlagSet("get", flag.ContinueOnError)
	id := fs.Int("id", 0, "page ID (integer)")
	path := fs.String("path", "", "page path (string)")

	// Suppress default usage output from FlagSet
	fs.SetOutput(os.Stderr)

	if err := fs.Parse(args); err != nil {
		return err
	}

	idProvided := false
	pathProvided := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "id" {
			idProvided = true
		}
		if f.Name == "path" {
			pathProvided = true
		}
	})

	if !idProvided && !pathProvided {
		WriteUserError("either --id or --path is required", "get")
		return fmt.Errorf("missing page identifier")
	}

	var result []byte
	var err error

	// If both provided, use --id and ignore --path
	if idProvided {
		result, err = c.GetPage(*id)
	} else {
		result, err = c.GetPageByPath(*path)
	}

	if err != nil {
		WriteGatewayError(err)
		return err
	}

	WriteJSON(result)
	return nil
}
