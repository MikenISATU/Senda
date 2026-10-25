#!/usr/bin/env bash
# Testnet deploy wrapper (macOS/Linux/Git Bash). Windows PowerShell: node ops/deployer/scripts/deploy-testnet.mjs
set -euo pipefail
cd "$(dirname "$0")/../../.."
exec node ops/deployer/scripts/deploy-testnet.mjs "$@"
