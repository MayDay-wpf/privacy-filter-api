#!/usr/bin/env bash
set -euo pipefail

# Unix/macOS compatibility wrapper. The actual implementation is cross-platform
# and lives in download-model.js so npm scripts also work on Windows.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "${SCRIPT_DIR}/download-model.js" "$@"
