#!/bin/bash
# BookList deploy script
# One-time setup: chmod +x ~/Desktop/MacBook/BookList/deploy.sh
# Then just run: ~/Desktop/MacBook/BookList/deploy.sh
set -e
REPO="$HOME/Desktop/MacBook/BookList"
cd "$REPO"

# Clear any stale git lock files left by the sandbox
rm -f .git/HEAD.lock .git/index.lock

echo "⬇️  Pulling latest changes from sandbox..."
git pull --rebase origin main
echo "⬆️  Pushing to GitHub (triggers Vercel)..."
git push origin main
echo "✅ Done! Vercel is deploying — check https://vercel.com/dashboard"
