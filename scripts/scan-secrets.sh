#!/bin/bash
# Secret scanning script using gitleaks
# Detects accidentally committed credentials in the repository

set -e

# Default configuration
CONFIG_FILE=".gitleaks.toml"
VERBOSE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --config)
      CONFIG_FILE="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--config <path>] [--verbose]"
      exit 1
      ;;
  esac
done

# Check if gitleaks is installed
if ! command -v gitleaks &> /dev/null; then
  echo "Error: gitleaks is not installed."
  echo "Install from https://github.com/gitleaks/gitleaks"
  exit 1
fi

# Check if config file exists
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Warning: Configuration file '$CONFIG_FILE' not found. Using default gitleaks configuration."
  CONFIG_ARG=""
else
  CONFIG_ARG="--config=$CONFIG_FILE"
fi

# Run gitleaks scan
echo "Scanning repository for secrets..."
if [[ "$VERBOSE" == "true" ]]; then
  echo "Using configuration: $CONFIG_FILE"
fi

# Run gitleaks detect
if gitleaks detect $CONFIG_ARG --source . --no-git 2>&1; then
  echo "✓ No secrets detected"
  exit 0
else
  EXIT_CODE=$?
  echo "✗ Secrets detected in repository!"
  echo ""
  echo "Please review the output above and:"
  echo "1. Remove secrets from files"
  echo "2. Move secrets to .env file (which is in .gitignore)"
  echo "3. If false positive, add to allowlist in $CONFIG_FILE"
  exit $EXIT_CODE
fi
