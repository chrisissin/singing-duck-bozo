#!/usr/bin/env bash
# Build and deploy Slack RAG Bot to AWS ECS.
# Run from repo root. Requires: aws cli, docker.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "$REPO_ROOT"

REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/slack-rag-bot"
IMAGE="${ECR_URI}:latest"

echo "Region: $REGION  Image: $IMAGE"

# ECR login
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# Build and push
docker build -t "$IMAGE" .
docker push "$IMAGE"

# Force new ECS deployment
aws ecs update-service --cluster slack-rag-cluster --service slack-rag-agent --force-new-deployment --region "$REGION"

echo "Done. Agent URL:"
aws elbv2 describe-load-balancers --names slack-rag-agent-alb --query 'LoadBalancers[0].DNSName' --output text 2>/dev/null || echo "http://<agent-alb-dns-name>"
