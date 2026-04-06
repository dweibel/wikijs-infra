package commands

import (
	"encoding/json"
	"fmt"
	"os"

	"wiki-cli/client"
)

// WriteJSON writes raw JSON bytes to stdout.
// This is the standard output path for all successful command responses.
func WriteJSON(data []byte) {
	os.Stdout.Write(data)
}

// WriteGatewayError writes a JSON error object to stderr for gateway errors.
// If err is a *client.GatewayError, the error and HTTP status are included.
// For other errors, a generic "Gateway request failed" message is used.
func WriteGatewayError(err error) {
	type cliError struct {
		Error   string `json:"error"`
		Details string `json:"details"`
	}

	var errObj cliError
	if gwErr, ok := err.(*client.GatewayError); ok {
		errObj = cliError{
			Error:   gwErr.Message,
			Details: fmt.Sprintf("HTTP %d", gwErr.StatusCode),
		}
	} else {
		errObj = cliError{
			Error:   "Gateway request failed",
			Details: err.Error(),
		}
	}

	errJSON, _ := json.Marshal(errObj)
	fmt.Fprintln(os.Stderr, string(errJSON))
}

// WriteUserError writes a plain text error message with a help hint to stderr.
// This is used for user input errors (missing args, invalid flags, etc.).
func WriteUserError(message string, helpCmd string) {
	fmt.Fprintf(os.Stderr, "Error: %s\n", message)
	fmt.Fprintf(os.Stderr, "Run 'wiki-cli help %s' for usage details\n", helpCmd)
}
