package commands

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"reflect"
	"testing"
	"testing/quick"

	"wiki-cli/client"
)

// Feature: wiki-cli, Property 7: Successful output is valid JSON passthrough
// **Validates: Requirements 9.1, 9.4**

// validJSON holds a generated valid JSON byte slice for property testing.
type validJSON struct {
	Data []byte
}

// Generate implements quick.Generator for validJSON.
// Produces random valid JSON objects with random keys and values.
func (validJSON) Generate(rand *rand.Rand, size int) reflect.Value {
	// Build a random JSON object with 1-5 key-value pairs.
	obj := make(map[string]interface{})
	numKeys := rand.Intn(5) + 1
	for i := 0; i < numKeys; i++ {
		key := randomAlphaString(rand, rand.Intn(10)+1)
		// Randomly choose value type: string, int, bool, or null
		switch rand.Intn(4) {
		case 0:
			obj[key] = randomAlphaString(rand, rand.Intn(20)+1)
		case 1:
			obj[key] = rand.Intn(10000)
		case 2:
			obj[key] = rand.Intn(2) == 0
		case 3:
			obj[key] = nil
		}
	}
	data, _ := json.Marshal(obj)
	return reflect.ValueOf(validJSON{Data: data})
}

// randomAlphaString generates a random alphabetic string of the given length.
func randomAlphaString(rand *rand.Rand, length int) string {
	buf := make([]byte, length)
	for i := range buf {
		buf[i] = byte('a' + rand.Intn(26))
	}
	return string(buf)
}

func TestWriteJSONPassthrough(t *testing.T) {
	cfg := &quick.Config{MaxCount: 100}

	err := quick.Check(func(input validJSON) bool {
		// Capture stdout by replacing os.Stdout with a pipe.
		origStdout := os.Stdout
		r, w, pipeErr := os.Pipe()
		if pipeErr != nil {
			t.Logf("failed to create pipe: %v", pipeErr)
			return false
		}
		os.Stdout = w

		// Call WriteJSON with the generated data.
		WriteJSON(input.Data)

		// Close the write end and restore stdout.
		w.Close()
		os.Stdout = origStdout

		// Read captured output.
		var buf bytes.Buffer
		if _, copyErr := buf.ReadFrom(r); copyErr != nil {
			t.Logf("failed to read from pipe: %v", copyErr)
			return false
		}
		r.Close()

		captured := buf.Bytes()

		// Verify output matches input exactly (byte-for-byte).
		if !bytes.Equal(captured, input.Data) {
			t.Logf("output mismatch:\n  expected: %s\n  got:      %s", string(input.Data), string(captured))
			return false
		}

		// Verify the output is valid JSON.
		if !json.Valid(captured) {
			t.Logf("output is not valid JSON: %s", string(captured))
			return false
		}

		return true
	}, cfg)

	if err != nil {
		t.Errorf("Property 7 failed: %v", err)
	}
}

// Feature: wiki-cli, Property 8: Gateway errors produce JSON error on stderr
// **Validates: Requirements 9.3**

// gatewayErrorInput holds a generated GatewayError for property testing.
type gatewayErrorInput struct {
	StatusCode int
	Message    string
}

// Generate implements quick.Generator for gatewayErrorInput.
// Produces random HTTP error status codes (400-599) and random message strings.
func (gatewayErrorInput) Generate(r *rand.Rand, size int) reflect.Value {
	statusCode := 400 + r.Intn(200) // 400–599
	msgLen := r.Intn(20) + 1
	message := randomAlphaString(r, msgLen)
	return reflect.ValueOf(gatewayErrorInput{
		StatusCode: statusCode,
		Message:    message,
	})
}

func TestWriteGatewayErrorProducesJSONOnStderr(t *testing.T) {
	cfg := &quick.Config{MaxCount: 100}

	err := quick.Check(func(input gatewayErrorInput) bool {
		gwErr := &client.GatewayError{
			Message:    input.Message,
			StatusCode: input.StatusCode,
			Body:       `{"error":"` + input.Message + `"}`,
		}

		// Capture stderr by replacing os.Stderr with a pipe.
		origStderr := os.Stderr
		r, w, pipeErr := os.Pipe()
		if pipeErr != nil {
			t.Logf("failed to create pipe: %v", pipeErr)
			return false
		}
		os.Stderr = w

		// Call WriteGatewayError with the generated error.
		WriteGatewayError(gwErr)

		// Close the write end and restore stderr.
		w.Close()
		os.Stderr = origStderr

		// Read captured output.
		var buf bytes.Buffer
		if _, copyErr := buf.ReadFrom(r); copyErr != nil {
			t.Logf("failed to read from pipe: %v", copyErr)
			return false
		}
		r.Close()

		captured := buf.Bytes()

		// Verify the output is valid JSON.
		if !json.Valid(captured) {
			t.Logf("stderr output is not valid JSON: %s", string(captured))
			return false
		}

		// Parse the JSON and verify it has "error" and "details" fields.
		var parsed map[string]interface{}
		if jsonErr := json.Unmarshal(captured, &parsed); jsonErr != nil {
			t.Logf("failed to parse stderr JSON: %v", jsonErr)
			return false
		}

		errorField, hasError := parsed["error"]
		detailsField, hasDetails := parsed["details"]

		if !hasError {
			t.Logf("stderr JSON missing 'error' field: %s", string(captured))
			return false
		}
		if !hasDetails {
			t.Logf("stderr JSON missing 'details' field: %s", string(captured))
			return false
		}

		// Verify the error field matches the gateway error message.
		errorStr, ok := errorField.(string)
		if !ok || errorStr != input.Message {
			t.Logf("error field mismatch: expected %q, got %v", input.Message, errorField)
			return false
		}

		// Verify the details field contains the HTTP status code.
		detailsStr, ok := detailsField.(string)
		if !ok {
			t.Logf("details field is not a string: %v", detailsField)
			return false
		}
		expectedDetails := fmt.Sprintf("HTTP %d", input.StatusCode)
		if detailsStr != expectedDetails {
			t.Logf("details field mismatch: expected %q, got %q", expectedDetails, detailsStr)
			return false
		}

		return true
	}, cfg)

	if err != nil {
		t.Errorf("Property 8 failed: %v", err)
	}
}
