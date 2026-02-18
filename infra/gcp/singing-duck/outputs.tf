output "project_id" {
  value       = var.project_id
  description = "GCP project ID"
}

output "region" {
  value       = var.region
  description = "Region"
}

output "cloud_sql_connection_name" {
  value       = google_sql_database_instance.main.connection_name
  description = "Cloud SQL connection name (for Cloud SQL Auth Proxy)"
}

output "cloud_sql_private_ip" {
  value       = google_sql_database_instance.main.private_ip_address
  description = "Cloud SQL private IP (used in DATABASE_URL with VPC)"
}

output "agent_url" {
  value       = google_cloud_run_v2_service.agent.uri
  description = "Agent service URL — use for Slack Event Subscriptions Request URL"
}

output "ollama_url" {
  value       = var.create_ollama_service ? google_cloud_run_v2_service.ollama[0].uri : null
  description = "Ollama Cloud Run service URL (when create_ollama_service = true)"
}

output "next_steps" {
  value = join("\n", concat([
    "1. Set Slack secrets: gcloud secrets versions add slack-bot-token --data-file=- (paste token)",
    "2. Set Slack signing secret: gcloud secrets versions add slack-signing-secret --data-file=-",
    "3. Enable pgvector: ./scripts/enable-pgvector.sh",
    "4. Build and deploy: ./infra/gcp/singing-duck/scripts/deploy.sh",
    "5. Configure Slack app Event Subscriptions Request URL: ${google_cloud_run_v2_service.agent.uri}slack/events"
  ], var.create_ollama_service ? ["6. Models are pulled automatically during deploy.sh (or run ./scripts/pull-ollama-models.sh manually)"] : []))
  description = "Post-apply steps"
}
