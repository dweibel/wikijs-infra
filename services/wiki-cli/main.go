package main

import (
	"fmt"
	"os"
	"strings"

	"wiki-cli/client"
	"wiki-cli/commands"
	"wiki-cli/config"
)

func main() {
	if len(os.Args) < 2 {
		commands.PrintUsage()
		os.Exit(1)
	}

	command := os.Args[1]

	// Handle help, --help, -h as the primary command
	if command == "help" || command == "--help" || command == "-h" {
		if err := commands.Help(os.Args[2:]); err != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}

	// Check if any remaining arg is --help or -h → show help for this command
	for _, arg := range os.Args[2:] {
		if arg == "--help" || arg == "-h" {
			if err := commands.Help([]string{command}); err != nil {
				os.Exit(1)
			}
			os.Exit(0)
		}
	}

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err)
		fmt.Fprintln(os.Stderr, "Run 'wiki-cli help' for usage details")
		os.Exit(1)
	}

	// Create gateway client
	c := client.New(cfg.GatewayURL, cfg.APIKey)

	// Dispatch to command
	switch command {
	case "search":
		err = commands.Search(c, os.Args[2:])
	case "get":
		err = commands.Get(c, os.Args[2:])
	case "list":
		err = commands.List(c, os.Args[2:])
	case "create":
		err = commands.Create(c, os.Args[2:], cfg.EnableWriteOps)
	case "update":
		err = commands.Update(c, os.Args[2:], cfg.EnableWriteOps)
	case "delete":
		err = commands.Delete(c, os.Args[2:], cfg.EnableWriteOps)
	case "move":
		err = commands.Move(c, os.Args[2:], cfg.EnableWriteOps)
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown command %q\n", command)
		fmt.Fprintf(os.Stderr, "\nValid commands: %s\n", strings.Join(commands.ValidCommands(), ", "))
		fmt.Fprintln(os.Stderr, "Run 'wiki-cli help' for usage details")
		os.Exit(1)
	}

	if err != nil {
		os.Exit(1)
	}
}
