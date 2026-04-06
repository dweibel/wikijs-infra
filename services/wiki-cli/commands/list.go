package commands

import (
	"wiki-cli/client"
)

// List executes the list command: fetches all pages from the gateway.
func List(c *client.Client, args []string) error {
	result, err := c.ListPages()
	if err != nil {
		WriteGatewayError(err)
		return err
	}

	WriteJSON(result)
	return nil
}
