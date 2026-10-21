#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Create the environment and install requirements first. See README.md." >&2
  exit 1
fi
exec .venv/bin/python app.py "$@"
