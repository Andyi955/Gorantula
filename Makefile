.PHONY: all build check test fmt vet clean run

# Default target
all: build

# Format the code
fmt:
	@echo "=> Formatting Go files..."
	go fmt ./...

# Run static analysis
vet:
	@echo "=> Running 'go vet'..."
	go vet ./...

# Run tests
test:
	@echo "=> Running tests..."
	go test -v ./...

# Run all checks (fmt, vet, test) - this is what "make check" does
check: fmt vet test
	@echo "=> All checks passed successfully!"

# Build the main application
build: check
	@echo "=> Building Gorantula..."
	go build -o gorantula main.go

# Clean up builds
clean:
	@echo "=> Cleaning up..."
	go clean
	rm -f gorantula

# Run the backend locally
run:
	go run main.go
