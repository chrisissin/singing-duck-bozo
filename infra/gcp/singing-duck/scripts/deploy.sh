#!/usr/bin/env bash
# Build and deploy Slack RAG Bot to Cloud Run (singing-duck).
# Run from repo root. Requires: gcloud, docker (or Cloud Build).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
cd "$REPO_ROOT"

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo singing-duck-boso)}"
REGION="${GCP_REGION:-us-central1}"
IMAGE="gcr.io/${PROJECT_ID}/slack-rag-bot"

echo "Project: $PROJECT_ID  Region: $REGION  Image: $IMAGE"

OLLAMA_URL=$(terraform -chdir="${SCRIPT_DIR}/.." output -raw ollama_url 2>/dev/null || true)

# Build and push (Cloud Build)
gcloud builds submit --tag "$IMAGE" --project "$PROJECT_ID" .

# Deploy Cloud Run service (agent)
gcloud run services update slack-rag-bot \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID"
if [[ -n "$OLLAMA_URL" ]]; then
  gcloud run services update slack-rag-bot \
    --update-env-vars="OLLAMA_BASE_URL=${OLLAMA_URL},OLLAMA_CHAT_MODEL=tinyllama,OLLAMA_EMBED_MODEL=nomic-embed-text,OLLAMA_MODEL=tinyllama" \
    --region "$REGION" \
    --project "$PROJECT_ID"
fi

# Deploy Cloud Run job (indexer)
gcloud run jobs update slack-rag-indexer \
  --image "$IMAGE" \
  --update-secrets="DATABASE_URL=database-url:latest,SLACK_BOT_TOKEN=slack-bot-token:latest" \
  --region "$REGION" \
  --project "$PROJECT_ID"
if [[ -n "$OLLAMA_URL" ]]; then
  gcloud run jobs update slack-rag-indexer \
    --update-env-vars="OLLAMA_BASE_URL=${OLLAMA_URL},OLLAMA_EMBED_MODEL=nomic-embed-text" \
    --region "$REGION" \
    --project "$PROJECT_ID"
fi

# Pull Ollama models after deploy (Cloud Run has ephemeral storage; models are lost on new revisions)
if [[ -n "$OLLAMA_URL" && "${SKIP_OLLAMA_PULL:-}" != "1" ]]; then
  echo ""
  echo "Pulling Ollama models (nomic-embed-text, tinyllama)..."
  "$SCRIPT_DIR/pull-ollama-models.sh" || {
    echo "Warning: Ollama model pull failed or timed out. Run manually: $SCRIPT_DIR/pull-ollama-models.sh"
  }
fi

echo ""
echo "Done. Agent URL:"
gcloud run services describe slack-rag-bot --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)'
