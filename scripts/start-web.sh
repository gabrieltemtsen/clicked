#!/bin/bash
# Quick startup script for the web application
echo "Starting Next.js web application..."
cd apps/web || exit 1
pnpm run dev
