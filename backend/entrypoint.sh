#!/bin/bash
set -e

# Install dependencies
echo "Installing npm dependencies..."
npm install

# Execute the original command
exec "$@"
