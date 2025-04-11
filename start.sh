#!/bin/bash

# Exit on error
set -e

# Create data directory if it doesn't exist
mkdir -p /app/data

# Copy database to persistent volume if it doesn't exist
if [ ! -f "/app/data/dev.db" ]; then
    cp dev.db /app/data/ 2>/dev/null || touch /app/data/dev.db
fi

# Start the application
echo "Starting application..."
node dist/index.js 