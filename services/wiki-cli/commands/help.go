package commands

import (
	"fmt"
	"os"
	"strings"
)

// validCommands is the ordered list of all recognized CLI commands.
var validCommands = []string{"search", "get", "list", "create", "update", "delete", "move", "help"}

// ValidCommands returns the list of valid command names.
func ValidCommands() []string {
	return append([]string{}, validCommands...)
}

// PrintUsage prints the CLI usage message to stderr (for when no args are provided).
func PrintUsage() {
	fmt.Fprintln(os.Stderr, "Usage: wiki-cli <command> [flags]")
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "Run 'wiki-cli help' for a list of available commands.")
}

// Help implements the help command.
// With no args, it prints top-level help listing all commands to stdout.
// With a valid command name, it prints detailed help for that command to stdout.
// With an unknown command name, it prints an error to stderr and returns an error.
func Help(args []string) error {
	if len(args) == 0 {
		printTopLevelHelp()
		return nil
	}

	cmd := args[0]
	if helpFunc, ok := commandHelp[cmd]; ok {
		helpFunc()
		return nil
	}

	// Unknown command
	fmt.Fprintf(os.Stderr, "Error: unknown command %q\n", cmd)
	fmt.Fprintf(os.Stderr, "\nValid commands: %s\n", strings.Join(validCommands, ", "))
	fmt.Fprintln(os.Stderr, "Run 'wiki-cli help' for usage details")
	return fmt.Errorf("unknown command: %s", cmd)
}

// commandHelp maps command names to their detailed help printer functions.
var commandHelp = map[string]func(){
	"search": helpSearch,
	"get":    helpGet,
	"list":   helpList,
	"create": helpCreate,
	"update": helpUpdate,
	"delete": helpDelete,
	"move":   helpMove,
	"help":   helpHelp,
}

// commandDescriptions provides one-line descriptions for top-level help.
var commandDescriptions = []struct {
	name string
	desc string
}{
	{"search", "Search wiki pages by keyword"},
	{"get", "Retrieve a page by ID or path"},
	{"list", "List all wiki pages"},
	{"create", "Create a new wiki page (write operation)"},
	{"update", "Update an existing wiki page (write operation)"},
	{"delete", "Delete a wiki page (write operation)"},
	{"move", "Move a wiki page to a new path (write operation)"},
	{"help", "Show help for a command"},
}

func printTopLevelHelp() {
	fmt.Println("wiki-cli — Wiki.js CLI tool")
	fmt.Println("")
	fmt.Println("Usage: wiki-cli <command> [flags]")
	fmt.Println("")
	fmt.Println("Commands:")
	for _, c := range commandDescriptions {
		fmt.Printf("  %-10s %s\n", c.name, c.desc)
	}
	fmt.Println("")
	fmt.Println("Run 'wiki-cli help <command>' for detailed help on a specific command.")
}

func helpSearch() {
	fmt.Println("Usage: wiki-cli search <query> [--top <n>]")
	fmt.Println("")
	fmt.Println("Search wiki pages by keyword using semantic search.")
	fmt.Println("")
	fmt.Println("Arguments:")
	fmt.Println("  <query>    Search query (string, required)")
	fmt.Println("")
	fmt.Println("Flags:")
	fmt.Println("  --top <n>  Maximum number of results to return (integer, optional, default: 5)")
	fmt.Println("")
	fmt.Println("Example:")
	fmt.Println("  wiki-cli search \"deployment guide\" --top 10")
}

func helpGet() {
	fmt.Println("Usage: wiki-cli get [--id <page_id>] [--path <page_path>]")
	fmt.Println("")
	fmt.Println("Retrieve a wiki page by its numeric ID or path. One of --id or --path is required.")
	fmt.Println("If both are provided, --id takes precedence.")
	fmt.Println("")
	fmt.Println("Flags:")
	fmt.Println("  --id <page_id>      Page ID (integer, optional)")
	fmt.Println("  --path <page_path>  Page path (string, optional)")
	fmt.Println("")
	fmt.Println("Example:")
	fmt.Println("  wiki-cli get --id 42")
	fmt.Println("  wiki-cli get --path \"/docs/setup\"")
}

func helpList() {
	fmt.Println("Usage: wiki-cli list")
	fmt.Println("")
	fmt.Println("List all wiki pages. No flags required.")
	fmt.Println("")
	fmt.Println("Example:")
	fmt.Println("  wiki-cli list")
}

func helpCreate() {
	fmt.Println("Usage: wiki-cli create --title <title> --path <path> --content <content> [--description <desc>] [--tags <tag1,tag2>]")
	fmt.Println("")
	fmt.Println("Create a new wiki page.")
	fmt.Println("")
	fmt.Println("Flags:")
	fmt.Println("  --title <title>            Page title (string, required)")
	fmt.Println("  --path <path>              Page path (string, required)")
	fmt.Println("  --content <content>        Page content (string, required)")
	fmt.Println("  --description <desc>       Page description (string, optional)")
	fmt.Println("  --tags <tag1,tag2,...>      Tags (comma-separated list, optional)")
	fmt.Println("")
	fmt.Println("Note: Requires ENABLE_WRITE_OPS=true environment variable.")
	fmt.Println("")
	fmt.Println("Example:")
	fmt.Println("  wiki-cli create --title \"Setup Guide\" --path \"/docs/setup\" --content \"# Setup\" --tags \"docs,setup\"")
}

func helpUpdate() {
	fmt.Println("Usage: wiki-cli update --id <page_id> [--title <title>] [--content <content>] [--description <desc>] [--tags <tag1,tag2>]")
	fmt.Println("")
	fmt.Println("Update an existing wiki page. At least one optional field must be provided.")
	fmt.Println("")
	fmt.Println("Flags:")
	fmt.Println("  --id <page_id>             Page ID (integer, required)")
	fmt.Println("  --title <title>            New page title (string, optional)")
	fmt.Println("  --content <content>        New page content (string, optional)")
	fmt.Println("  --description <desc>       New page description (string, optional)")
	fmt.Println("  --tags <tag1,tag2,...>      Tags (comma-separated list, optional)")
	fmt.Println("")
	fmt.Println("Note: Requires ENABLE_WRITE_OPS=true environment variable.")
	fmt.Println("")
	fmt.Println("Example:")
	fmt.Println("  wiki-cli update --id 42 --title \"Updated Title\" --content \"New content\"")
}

func helpDelete() {
	fmt.Println("Usage: wiki-cli delete --id <page_id>")
	fmt.Println("")
	fmt.Println("Delete a wiki page by its ID.")
	fmt.Println("")
	fmt.Println("Flags:")
	fmt.Println("  --id <page_id>  Page ID (integer, required)")
	fmt.Println("")
	fmt.Println("Note: Requires ENABLE_WRITE_OPS=true environment variable.")
	fmt.Println("")
	fmt.Println("Example:")
	fmt.Println("  wiki-cli delete --id 42")
}

func helpMove() {
	fmt.Println("Usage: wiki-cli move --id <page_id> --destination <new_path> [--locale <locale>]")
	fmt.Println("")
	fmt.Println("Move a wiki page to a new path.")
	fmt.Println("")
	fmt.Println("Flags:")
	fmt.Println("  --id <page_id>              Page ID (integer, required)")
	fmt.Println("  --destination <new_path>    Destination path (string, required)")
	fmt.Println("  --locale <locale>           Destination locale (string, optional)")
	fmt.Println("")
	fmt.Println("Note: Requires ENABLE_WRITE_OPS=true environment variable.")
	fmt.Println("")
	fmt.Println("Example:")
	fmt.Println("  wiki-cli move --id 42 --destination \"/docs/archive/setup\" --locale en")
}

func helpHelp() {
	fmt.Println("Usage: wiki-cli help [<command>]")
	fmt.Println("")
	fmt.Println("Show help information. Without arguments, lists all commands.")
	fmt.Println("With a command name, shows detailed help for that command.")
	fmt.Println("")
	fmt.Println("Example:")
	fmt.Println("  wiki-cli help")
	fmt.Println("  wiki-cli help search")
}
