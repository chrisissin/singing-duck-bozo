#!/usr/bin/env bash
# Pull Ollama models on the ECS Ollama service.
# Run from repo root.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Getting Ollama URL from Terraform..."
OLLAMA_URL=$(terraform -chdir="$TF_DIR" output -raw ollama_url 2>/dev/null || true)

if [[ -z "$OLLAMA_URL" ]]; then
  echo "Error: ollama_url not found. Is create_ollama_service = true?"
  exit 1
fi

echo "Ollama URL: $OLLAMA_URL"
echo ""

echo "Pulling chat model (tinyllama)..."
curl "${OLLAMA_URL}/api/pull" -d '{"name":"tinyllama"}' || {
  echo "Error: tinyllama pull failed."
  exit 1
}

echo ""
echo "Pulling embedding model (nomic-embed-text)..."
curl "${OLLAMA_URL}/api/pull" -d '{"name":"nomic-embed-text"}' || {
  echo "Error: nomic-embed-text pull failed"
  exit 1
}

echo ""
echo "Done. Models are available."
