# GCP Architecture Options for Slack RAG Bot

This document outlines several architecture patterns for hosting the Slack RAG Bot on Google Cloud Platform.

## System Components

1. **Agent Entry Point** (`server.js`): Express + Slack Bolt app
   - Handles Slack webhooks (`POST /slack/events`)
   - Serves Web UI (`GET /`, `POST /api/analyze`)
   - Requires: Public endpoint for Slack webhooks, persistent connection

2. **Indexer** (`sync_cron.js`, `sync_once.js`): Background service
   - Syncs Slack messages to Postgres
   - Runs periodically (cron-like)
   - Requires: Scheduled execution, database access

3. **MCP Server** (`gcpMcpServer.js`): Child process via stdio
   - Executes GCP automation actions
   - Spawned by MCP client in agent
   - Requires: Same host/container as agent, gcloud CLI access

## Shared Infrastructure Requirements

- **Postgres with pgvector**: Cloud SQL for PostgreSQL
- **Ollama**: LLM inference (can be hosted on VM, container, or separate service)
- **Secrets**: Secret Manager for Slack tokens, DB credentials
- **Storage**: Cloud Storage for policies/config (optional)

---

## Architecture Option 1: Cloud Run (Serverless) - Recommended for Most Cases

### Overview
Fully serverless architecture using Cloud Run for compute and Cloud Scheduler for indexing.

### Architecture Diagram
```
┌─────────────────────────────────────────────────────────┐
│                    Cloud Load Balancer                  │
│              (HTTPS, SSL Termination)                   │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────▼───────────┐
         │   Cloud Run Service   │
         │   (Agent Entry Point) │
         │   - server.js         │
         │   - Auto-scaling      │
         │   - HTTP/2, gRPC      │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   Cloud Scheduler     │
         │   (Indexer Cron)      │
         │   - sync_once.js      │
         │   - HTTP trigger      │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   Cloud Run Job       │
         │   (Indexer Worker)    │
         │   - sync_once.js      │
         └───────────────────────┘
                     │
         ┌───────────▼───────────┐
         │   Cloud SQL            │
         │   (Postgres + pgvector)│
         └───────────────────────┘
                     │
         ┌───────────▼───────────┐
         │   Ollama Service      │
         │   (Cloud Run or VM)   │
         └───────────────────────┘
```

### Components

**1. Agent Entry Point (Cloud Run Service)**
- **Service**: Cloud Run service
- **Container**: Node.js app with all dependencies
- **Scaling**: Auto-scales 0-10 instances based on traffic
- **Endpoint**: Public HTTPS URL for Slack webhooks
- **Environment**: 
  - `OLLAMA_BASE_URL`: Points to Ollama service
  - `DATABASE_URL`: Cloud SQL connection
  - Secrets from Secret Manager

**2. Indexer (Cloud Run Job + Cloud Scheduler)**
- **Job**: Cloud Run Job (runs sync_once.js)
- **Scheduler**: Cloud Scheduler triggers job via HTTP
- **Frequency**: Every 5 minutes (configurable)
- **Resources**: Can use higher CPU/memory for batch processing

**3. MCP Server**
- **Deployment**: Runs as child process within Cloud Run service
- **Access**: Uses Workload Identity for GCP API access
- **gcloud CLI**: Pre-installed in container or use GCP SDK

**4. Database (Cloud SQL)**
- **Type**: Cloud SQL for PostgreSQL
- **Extensions**: pgvector enabled
- **Connection**: Private IP or Cloud SQL Proxy
- **Backup**: Automated daily backups

**5. Ollama Service**
- **Option A**: Cloud Run service (stateless, slower cold starts)
- **Option B**: Compute Engine VM (persistent, faster)
- **Option C**: GKE pod (if using Kubernetes)

### Pros
✅ Fully serverless - no infrastructure management
✅ Auto-scaling - handles traffic spikes automatically
✅ Pay-per-use - only pay when running
✅ Built-in HTTPS, load balancing
✅ Easy deployment via Cloud Build
✅ Cloud Run Jobs perfect for scheduled tasks

### Cons
❌ Cold starts (1-2s) for first request after idle
❌ Ollama model loading can be slow on Cloud Run
❌ MCP server as child process works but not ideal
❌ 15-minute timeout limit (can be extended to 60min)

### Cost Estimate (Monthly)
- Cloud Run: ~$20-50 (depends on traffic)
- Cloud SQL (db-f1-micro): ~$7
- Cloud Scheduler: ~$0.10
- Cloud Run Jobs: ~$5-10
- **Total**: ~$32-67/month

---

## Architecture Option 2: GKE (Kubernetes) - Recommended for Scale

### Overview
Containerized architecture on Google Kubernetes Engine with separate deployments for each component.

### Architecture Diagram
```
┌─────────────────────────────────────────────────────────┐
│              Cloud Load Balancer (Ingress)              │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────▼───────────┐
         │   GKE Cluster          │
         │                        │
         │   ┌─────────────────┐  │
         │   │ Agent Deployment│  │
         │   │ (server.js)     │  │
         │   │ Replicas: 2-5   │  │
         │   └─────────────────┘  │
         │                        │
         │   ┌─────────────────┐  │
         │   │ Indexer CronJob │  │
         │   │ (sync_once.js)   │  │
         │   │ Schedule: */5   │  │
         │   └─────────────────┘  │
         │                        │
         │   ┌─────────────────┐  │
         │   │ Ollama Service   │  │
         │   │ (StatefulSet)    │  │
         │   │ Replicas: 1     │  │
         │   └─────────────────┘  │
         │                        │
         │   ┌─────────────────┐  │
         │   │ MCP Server       │  │
         │   │ (Sidecar)       │  │
         │   └─────────────────┘  │
         └───────────┬─────────────┘
                     │
         ┌───────────▼───────────┐
         │   Cloud SQL            │
         │   (Postgres + pgvector)│
         └───────────────────────┘
```

### Components

**1. Agent Entry Point (Deployment)**
- **Type**: Kubernetes Deployment
- **Replicas**: 2-5 (high availability)
- **Service**: ClusterIP + Ingress for external access
- **Resources**: 1-2 CPU, 2-4GB RAM per pod
- **Health Checks**: Liveness and readiness probes

**2. Indexer (CronJob)**
- **Type**: Kubernetes CronJob
- **Schedule**: `*/5 * * * *` (every 5 minutes)
- **Resources**: 0.5 CPU, 1GB RAM
- **Concurrency**: Allow only one at a time

**3. MCP Server**
- **Option A**: Sidecar container in agent pod
- **Option B**: Separate Deployment with service
- **Communication**: stdio (sidecar) or HTTP (separate)

**4. Ollama Service (StatefulSet)**
- **Type**: StatefulSet (persistent model storage)
- **Replicas**: 1 (or more for HA)
- **Storage**: PersistentVolume for models
- **Resources**: 4-8 CPU, 16-32GB RAM
- **Service**: ClusterIP for internal access

**5. Database (Cloud SQL)**
- **Connection**: Cloud SQL Proxy sidecar or Private IP
- **Connection Pooling**: PgBouncer sidecar (optional)

### Pros
✅ Full control over infrastructure
✅ High availability with multiple replicas
✅ Better for long-running Ollama service
✅ Flexible scaling policies
✅ Can use node pools with GPU for Ollama
✅ Better resource isolation

### Cons
❌ More complex setup and management
❌ Higher operational overhead
❌ More expensive (cluster management costs)
❌ Requires Kubernetes expertise

### Cost Estimate (Monthly)
- GKE Cluster (e2-standard-4 x 3 nodes): ~$150
- Cloud SQL (db-f1-micro): ~$7
- Load Balancer: ~$18
- **Total**: ~$175/month (minimum)

---

## Architecture Option 3: Compute Engine (VMs) - Simple & Cost-Effective

### Overview
Traditional VM-based architecture with all services on one or multiple VMs.

### Architecture Diagram
```
┌─────────────────────────────────────────────────────────┐
│              Cloud Load Balancer                        │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────▼───────────┐
         │   Compute Engine VM    │
         │   (e2-standard-4)      │
         │                        │
         │   ┌─────────────────┐  │
         │   │ Agent (PM2)     │  │
         │   │ server.js       │  │
         │   └─────────────────┘  │
         │                        │
         │   ┌─────────────────┐  │
         │   │ Ollama Service   │  │
         │   │ (systemd)       │  │
         │   └─────────────────┘  │
         │                        │
         │   ┌─────────────────┐  │
         │   │ MCP Server       │  │
         │   │ (child process) │  │
         │   └─────────────────┘  │
         └───────────┬─────────────┘
                     │
         ┌───────────▼───────────┐
         │   Cloud Scheduler     │
         │   (HTTP trigger)      │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   Cloud Functions     │
         │   (Indexer)           │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   Cloud SQL            │
         │   (Postgres + pgvector)│
         └───────────────────────┘
```

### Components

**1. Agent Entry Point (VM)**
- **Instance**: e2-standard-4 (4 vCPU, 16GB RAM)
- **OS**: Ubuntu 22.04 LTS
- **Process Manager**: PM2 or systemd
- **Reverse Proxy**: Nginx for SSL termination
- **Auto-restart**: systemd service

**2. Indexer**
- **Option A**: Cron job on same VM (`sync_cron.js`)
- **Option B**: Cloud Functions triggered by Cloud Scheduler
- **Option C**: Separate smaller VM for indexing

**3. Ollama Service**
- **Installation**: Direct install on VM
- **Service**: systemd service
- **Models**: Stored on persistent disk
- **Port**: 11434 (internal only, behind firewall)

**4. MCP Server**
- **Deployment**: Runs as child process (current implementation)
- **Access**: Uses VM's service account for GCP API

**5. Database (Cloud SQL)**
- **Connection**: Private IP or Cloud SQL Proxy
- **Network**: VPC peering or private service connection

### Pros
✅ Simple setup - familiar VM model
✅ Cost-effective for steady traffic
✅ Full control over environment
✅ Easy to debug and troubleshoot
✅ Good for Ollama (persistent, no cold starts)

### Cons
❌ Manual scaling (need to resize VM)
❌ Single point of failure (unless multiple VMs)
❌ More operational overhead
❌ Need to manage OS updates, security patches

### Cost Estimate (Monthly)
- Compute Engine (e2-standard-4): ~$100
- Cloud SQL (db-f1-micro): ~$7
- Load Balancer: ~$18
- Persistent Disk (100GB): ~$17
- **Total**: ~$142/month

---

## Architecture Option 4: Hybrid (Cloud Run + VM for Ollama)

### Overview
Best of both worlds: Cloud Run for agent/indexer, dedicated VM for Ollama.

### Architecture Diagram
```
┌─────────────────────────────────────────────────────────┐
│              Cloud Load Balancer                        │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────▼───────────┐
         │   Cloud Run Service   │
         │   (Agent Entry Point) │
         │   - server.js         │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   Cloud Run Job       │
         │   (Indexer)           │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   Compute Engine VM   │
         │   (Ollama Service)    │
         │   - e2-standard-4     │
         │   - Internal only     │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   Cloud SQL            │
         │   (Postgres + pgvector)│
         └───────────────────────┘
```

### Components

**1. Agent Entry Point (Cloud Run)**
- Same as Option 1
- `OLLAMA_BASE_URL` points to VM's internal IP

**2. Indexer (Cloud Run Job)**
- Same as Option 1
- Triggered by Cloud Scheduler

**3. Ollama Service (VM)**
- Dedicated VM for Ollama
- Internal-only (no public IP)
- VPC firewall rules allow Cloud Run access
- Persistent disk for models

**4. MCP Server**
- Runs as child process in Cloud Run service
- Uses Workload Identity

### Pros
✅ Serverless benefits for agent (auto-scaling, pay-per-use)
✅ Dedicated Ollama VM (no cold starts, persistent models)
✅ Cost-effective (smaller VM just for Ollama)
✅ Best performance for LLM inference

### Cons
❌ More complex networking (VPC, firewall rules)
❌ Two different deployment models to manage

### Cost Estimate (Monthly)
- Cloud Run: ~$20-50
- Cloud Run Jobs: ~$5-10
- Compute Engine (e2-standard-2 for Ollama): ~$50
- Cloud SQL: ~$7
- Cloud Scheduler: ~$0.10
- **Total**: ~$82-117/month

---

## Comparison Matrix

| Feature | Cloud Run | GKE | Compute Engine | Hybrid |
|---------|-----------|-----|----------------|--------|
| **Setup Complexity** | Low | High | Medium | Medium |
| **Operational Overhead** | Low | High | Medium | Low |
| **Auto-scaling** | ✅ Excellent | ✅ Good | ❌ Manual | ✅ Excellent |
| **Cost (Low Traffic)** | $32-67 | $175+ | $142 | $82-117 |
| **Cost (High Traffic)** | Scales well | Scales well | Need resize | Scales well |
| **Cold Starts** | ⚠️ 1-2s | ✅ None | ✅ None | ⚠️ Agent only |
| **Ollama Performance** | ⚠️ Slow | ✅ Good | ✅ Excellent | ✅ Excellent |
| **High Availability** | ✅ Built-in | ✅ Excellent | ⚠️ Manual | ✅ Built-in |
| **Best For** | Most cases | Large scale | Simple, steady | Production |

---

## Recommended Architecture by Use Case

### **Start Small / MVP** → Option 1 (Cloud Run)
- Fastest to deploy
- Lowest operational overhead
- Good enough performance for testing

### **Production / Moderate Scale** → Option 4 (Hybrid)
- Best balance of cost and performance
- Serverless benefits for agent
- Dedicated Ollama for consistent performance

### **Large Scale / Enterprise** → Option 2 (GKE)
- Full control and flexibility
- High availability requirements
- Multiple teams/environments

### **Simple / Cost-Conscious** → Option 3 (Compute Engine)
- Predictable traffic patterns
- Limited budget
- Prefer traditional VM model

---

## Implementation Steps (Cloud Run - Option 1)

### 1. Prepare Container
```dockerfile
# Dockerfile
FROM node:20-slim

WORKDIR /app

# Install gcloud CLI for MCP server
RUN apt-get update && apt-get install -y \
    curl \
    && curl https://sdk.cloud.google.com | bash \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 8080

CMD ["node", "src/server.js"]
```

### 2. Deploy Agent Service
```bash
# Build and deploy
gcloud builds submit --tag gcr.io/PROJECT_ID/slack-rag-bot
gcloud run deploy slack-rag-bot \
  --image gcr.io/PROJECT_ID/slack-rag-bot \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="OLLAMA_BASE_URL=http://ollama-service:11434" \
  --set-secrets="SLACK_BOT_TOKEN=slack-bot-token:latest,SLACK_SIGNING_SECRET=slack-signing-secret:latest"
```

### 3. Deploy Indexer Job
```bash
gcloud run jobs create slack-rag-indexer \
  --image gcr.io/PROJECT_ID/slack-rag-bot \
  --region us-central1 \
  --command="node" \
  --args="src/indexer/sync_once.js" \
  --set-env-vars="DATABASE_URL=..."
```

### 4. Setup Cloud Scheduler
```bash
gcloud scheduler jobs create http slack-rag-indexer-job \
  --schedule="*/5 * * * *" \
  --uri="https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/PROJECT_ID/jobs/slack-rag-indexer:run" \
  --http-method=POST \
  --oauth-service-account-email=PROJECT_NUMBER-compute@developer.gserviceaccount.com
```

---

## Security Considerations

1. **Secrets Management**: Use Secret Manager for all sensitive data
2. **Network Security**: 
   - Private IP for Cloud SQL
   - VPC firewall rules
   - IAM for service accounts
3. **Workload Identity**: Use for GCP API access (no service account keys)
4. **SSL/TLS**: Cloud Load Balancer handles SSL termination
5. **Database**: Enable SSL connections, use private IP

---

## Monitoring & Observability

1. **Cloud Logging**: All services log to Cloud Logging
2. **Cloud Monitoring**: Set up alerts for:
   - Agent service errors
   - Indexer job failures
   - Database connection issues
   - Ollama service health
3. **Error Reporting**: Cloud Error Reporting for exceptions
4. **Trace**: Cloud Trace for request tracing (if using HTTP)

---

## Next Steps

1. Choose architecture option based on requirements
2. Set up GCP project and enable APIs
3. Create Cloud SQL instance with pgvector
4. Deploy Ollama service (VM or Cloud Run)
5. Build and deploy agent service
6. Set up indexer job and scheduler
7. Configure secrets and IAM
8. Test Slack webhook integration
9. Monitor and optimize
