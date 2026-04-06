BINARY_NAME := wiki-cli

.PHONY: all build clean test

all: build

build:
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o $(BINARY_NAME) ./

clean:
	rm -f $(BINARY_NAME)

test:
	go test ./...
