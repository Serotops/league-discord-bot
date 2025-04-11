#!/bin/bash

# Create data directory if it doesn't exist
mkdir -p /app/data

# Copy database to persistent volume if it doesn't exist
if [ ! -f "/app/data/dev.db" ]; then
    cp dev.db /app/data/ 2>/dev/null || touch /app/data/dev.db
fi

# Start the application in the background
node dist/index.js &

# Wait for the server to start
sleep 10

# Keep the container running
tail -f /dev/null 