#!/bin/bash

# Build the project using Vite
echo "Building the project..."
npm run build

# Deploy to Firebase Hosting
echo "Deploying to Firebase Hosting..."
firebase deploy --only hosting

echo "Done!"
