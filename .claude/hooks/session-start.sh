#!/usr/bin/env bash
# Makes a fresh session able to run tests and lint immediately: installs
# dependencies if they are missing. Cheap when node_modules already exists.
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 0

if [ ! -d node_modules ]; then
  echo "Installing dependencies..." >&2
  npm ci --no-audit --no-fund >&2 2>&1 || npm install --no-audit --no-fund >&2 2>&1
fi

echo "Arrow Maze. Read CLAUDE.md and docs/WORKFLOW.md before writing code. Run 'npm run verify' before any PR."
