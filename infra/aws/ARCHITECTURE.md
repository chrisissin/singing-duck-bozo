# Slack RAG Bot — AWS Architecture

## Infrastructure Overview

The Slack RAG Bot runs on AWS using ECS Fargate, RDS PostgreSQL, Secrets Manager, and EventBridge. This document describes the infrastructure layout, data flows, and design decisions.

---

## System Architecture Diagram

```mermaid
flowchart TB
    subgraph Internet["Internet"]
        Slack[Slack API<br/>Events & Webhooks]
        User[User Browser<br/>Web UI]
        PullScript["pull-ollama-models.sh<br/>(run locally)"]
    end

    subgraph PublicSubnets["Public Subnets"]
        ALBAgent["ALB<br/>slack-rag-agent-alb<br/>:80"]
        ALBOllama["ALB<br/>slack-rag-ollama-alb<br/>:80"]
    end

    subgraph PrivateSubnets["Private Subnets"]
        subgraph ECS["ECS Fargate Cluster"]
            Agent["Agent Service<br/>slack-rag-agent<br/>Node.js :8080"]
            Ollama["Ollama Service<br/>slack-rag-ollama<br/>ollama/ollama :8080"]
        end
        
        IndexerTask["Indexer Task<br/>scheduled run<br/>sync_once.js"]
    end

    subgraph Data["Data Layer"]
        RDS["RDS PostgreSQL<br/>slack-rag-db<br/>pgvector"]
        Secrets["Secrets Manager<br/>slack-bot-token<br/>slack-signing-secret<br/>database-url"]
    end

    subgraph Scheduling["Scheduling"]
        EventBridge["EventBridge<br/>rate(30 minutes)"]
    end

    Slack -->|POST /slack/events| ALBAgent
    User -->|GET /, POST /api/analyze| ALBAgent
    PullScript -->|POST /api/pull| ALBOllama

    ALBAgent -->|:8080| Agent
    ALBOllama -->|:8080| Ollama

    Agent -->|embeddings, chat| Ollama
    Agent -->|DATABASE_URL| RDS
    Agent -->|env vars| Secrets

    EventBridge -->|RunTask| IndexerTask
    IndexerTask -->|embeddings| Ollama
    IndexerTask -->|DATABASE_URL, SLACK_BOT_TOKEN| Secrets
    IndexerTask -->|upsert chunks| RDS

    style Agent fill:#ff9800
    style Ollama fill:#2196f3
    style RDS fill:#4caf50
    style Secrets fill:#9c27b0
```

---

## Network Architecture

```mermaid
flowchart TB
    subgraph VPC["VPC (10.0.0.0/16)"]
        subgraph Public["Public Subnets"]
            IGW["Internet Gateway"]
            NAT1["NAT Gateway 1"]
            NAT2["NAT Gateway 2"]
            Pub1["10.0.0.0/24"]
            Pub2["10.0.1.0/24"]
        end

        subgraph Private["Private Subnets"]
            Priv1["10.0.10.0/24<br/>ECS Agent, Ollama, Indexer"]
            Priv2["10.0.11.0/24<br/>RDS"]
        end

        RDS["RDS PostgreSQL<br/>Private IP only"]
    end

    Internet["Internet"] --> IGW
    IGW --> Public
    Public --> ALB["ALBs"]
    Private --> NAT1
    Private --> NAT2
    NAT1 --> IGW
    NAT2 --> IGW

    ALB --> ECS["ECS Tasks"]
    ECS --> RDS
```

---

## Component Details

### Entry Points

| Component | Purpose |
|-----------|---------|
| **slack-rag-agent-alb** | Receives Slack events (`/slack/events`), Web UI traffic (`/`, `/api/analyze`) |
| **slack-rag-ollama-alb** | Receives model pull requests (`/api/pull`) and inference (`/api/embeddings`, `/api/chat`, `/api/generate`) |

### ECS Services

| Service | Image | CPU | Memory | Port |
|---------|-------|-----|--------|------|
| **slack-rag-agent** | ECR: slack-rag-bot | 512 | 2048 MB | 8080 |
| **slack-rag-ollama** | Docker Hub: ollama/ollama | 4096 | 8192 MB | 8080 |

### Scheduled Task

| Task | Schedule | Command |
|------|----------|---------|
| **slack-rag-indexer** | EventBridge: rate(30 minutes) | `node src/indexer/sync_once.js` |

### Data Store

| Resource | Engine | Purpose |
|----------|--------|---------|
| **slack-rag-db** | RDS PostgreSQL 15 | Stores indexed Slack chunks with pgvector embeddings |

### Secrets

| Secret | Used By |
|--------|---------|
| slack-rag/slack-bot-token | Agent, Indexer |
| slack-rag/slack-signing-secret | Agent |
| slack-rag/database-url | Agent, Indexer |

---

## Request Flows

### 1. Slack Event (e.g., message in channel)

```
Slack → ALB (:80) → Agent (:8080)
       → Verify signing secret
       → Process message (parse, retrieve RAG, decide, format)
       → Agent → Ollama (embeddings for retrieve, chat for answer)
       → Agent → RDS (search similar chunks)
       → Agent → Slack (post reply)
```

### 2. Web UI Query

```
User → ALB (:80) → Agent (:8080)
     → POST /api/analyze { text }
     → Retrieve contexts (Agent → Ollama embeddings, Agent → RDS)
     → Build RAG prompt, Ollama chat
     → Return JSON response
```

### 3. Indexer (scheduled)

```
EventBridge (every 30 min) → ECS RunTask (indexer)
→ Fetch Slack channels, messages, threads
→ Ollama embeddings per chunk
→ RDS upsert chunks
```

### 4. Model Pull (one-time / after deploy)

```
User runs pull-ollama-models.sh
→ curl Ollama ALB /api/pull
→ Ollama downloads tinyllama, nomic-embed-text
```

---

## Security

- **VPC isolation**: ECS tasks and RDS run in private subnets; no direct internet access.
- **Secrets**: Injected at task startup from Secrets Manager; never in code or logs.
- **RDS**: Not publicly accessible; only ECS tasks in the same VPC can connect.
- **IAM**: Task execution role for ECR/Secrets; task role for app-level permissions.

---

## Terraform Layout

```
infra/aws/
├── main.tf          # Provider, locals (ollama_url, agent_image)
├── variables.tf     # region, db_instance_class, ollama_cpu, etc.
├── outputs.tf       # agent_url, ollama_url, ecr_repository_url
├── vpc.tf           # VPC, subnets, NAT, route tables
├── rds.tf           # RDS instance, subnet group, security group
├── secrets.tf       # Secrets Manager (Slack, database URL)
├── ecr.tf           # ECR repository for slack-rag-bot
├── ecs.tf           # Cluster, IAM, security groups
├── alb.tf           # Agent ALB, target group, listener
├── ollama.tf        # Ollama ALB, target group, listener
├── ecs_agent.tf     # Agent task def, service
├── ecs_ollama.tf    # Ollama task def, service
├── ecs_indexer.tf   # Indexer task def
└── eventbridge.tf   # Schedule rule, ECS target
```

---

## GCP vs AWS Mapping

| GCP | AWS |
|-----|-----|
| Cloud Run (agent) | ECS Fargate + ALB |
| Cloud Run (Ollama) | ECS Fargate + ALB |
| Cloud Run Job (indexer) | EventBridge → ECS RunTask |
| Cloud Scheduler | EventBridge Rule |
| Cloud SQL | RDS PostgreSQL |
| Secret Manager | Secrets Manager |
| VPC Connector | Private subnets + NAT |
| Cloud Build / GCR | ECR + Docker |
