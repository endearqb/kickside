#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/proposed/frontend"
rm -rf dist
tsc -p tsconfig.json
node --test workspacePaneShelfCore.test.mjs
