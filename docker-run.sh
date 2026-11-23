#!/bin/bash
set -e

echo "Installing production dependencies..."
npm ci --only=production

echo "Building Docker image..."
docker build -t gta6-auto-clips .

echo "Starting container..."
docker run -p 3000:3000 \
  -e BYNARA_API_KEY=$BYNARA_API_KEY \
  -e INSTAGRAM_USERNAME=$INSTAGRAM_USERNAME \
  -e INSTAGRAM_PASSWORD=$INSTAGRAM_PASSWORD \
  gta6-auto-clips
