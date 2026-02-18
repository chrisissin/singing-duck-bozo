# AWS Infrastructure (Terraform)

Deploys the Slack RAG Bot to AWS with ECS Fargate, RDS PostgreSQL, and optional Ollama.

📄 **[Architecture document](ARCHITECTURE.md)** — diagrams, data flows, component details.

## Architecture

| Component | AWS Service |
|-----------|-------------|
| **Agent (Web UI + Slack)** | ECS Fargate + ALB |
| **Ollama** | ECS Fargate + ALB (optional) |
| **Indexer (scheduled)** | ECS Fargate + EventBridge |
| **Database** | RDS PostgreSQL (pgvector) |
| **Secrets** | Secrets Manager |

## Prerequisites

- AWS CLI configured (`aws configure`)
- Terraform >= 1.0
- Docker (for build/push)

## Quick Start

```bash
cd infra/aws
terraform init
terraform plan
terraform apply
```

## Post-Apply Steps

1. **Set Slack secrets** in Secrets Manager:
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id slack-rag/slack-bot-token \
     --secret-string 'xoxb-your-token'
   aws secretsmanager put-secret-value \
     --secret-id slack-rag/slack-signing-secret \
     --secret-string 'your-signing-secret'
   aws secretsmanager put-secret-value \
     --secret-id slack-rag/github-token \
     --secret-string 'ghp_...'
   ```

2. **Enable pgvector** – connect to RDS (via Session Manager, bastion, or RDS Query Editor) and run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

3. **Build and deploy**:
   ```bash
   ./infra/aws/scripts/deploy.sh
   ```

4. **Configure Slack** – Event Subscriptions Request URL: `http://<agent-alb-dns>/slack/events`

5. **Pull Ollama models** (if `create_ollama_service = true`):
   ```bash
   ./infra/aws/scripts/pull-ollama-models.sh
   ```

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `region` | us-east-1 | AWS region |
| `db_instance_class` | db.t3.micro | RDS instance size |
| `create_ollama_service` | true | Deploy Ollama ECS service |
| `ollama_cpu` | 4096 | Ollama CPU units (1024 = 1 vCPU) |
| `ollama_memory` | 8192 | Ollama memory (MB) |
| `indexer_schedule` | rate(30 minutes) | EventBridge schedule |

## Outputs

- `agent_url` – Use for Slack webhook and Web UI
- `ollama_url` – Use for model pulls (when Ollama is created)
- `ecr_repository_url` – Push your image here
- `rds_endpoint` – RDS hostname for pgvector setup

## Notes

- **Secrets**: ECS injects secrets from Secrets Manager into the task; the app receives them as env vars.
- **pgvector**: RDS PostgreSQL 15 supports the pgvector extension. Enable it before indexing.
- **Ollama**: Same architecture as GCP – keep min instances so models persist after pull.
