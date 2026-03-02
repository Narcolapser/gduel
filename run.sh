#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8000}"
PYTHON_BIN="${PYTHON_BIN:-}"

if [[ -z "$PYTHON_BIN" ]]; then
	if [[ -x "./.venv/bin/python" ]]; then
		PYTHON_BIN="./.venv/bin/python"
	else
		PYTHON_BIN="python3"
	fi
fi

"$PYTHON_BIN" server.py "$PORT" .
