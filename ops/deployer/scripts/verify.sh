#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
exec node ops/deployer/scripts/verify.mjs "$@"
