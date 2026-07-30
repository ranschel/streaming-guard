#!/bin/zsh

set -e
cd "${0:A:h}"

echo "Starting the Streaming Guard local evaluation and publishing operator…"
echo "Leave this window open while the evaluation runs."
echo

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  CODEX_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  if [[ -x "$CODEX_NODE" ]]; then
    NODE_BIN="$CODEX_NODE"
  else
    echo "Node.js was not found. Open this project in Codex once, then try again."
    read -k 1 "?Press any key to close."
    exit 1
  fi
fi

"$NODE_BIN" scripts/local-eval-publish-server.mjs &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM

sleep 1
open "http://127.0.0.1:8000/#eval-publish"
wait "$server_pid"
