# Service accounts and IAM for Cloud Run agent and indexer job
resource "google_service_account" "agent" {
  account_id   = "slack-rag-agent"
  display_name = "Slack RAG Bot Agent (Cloud Run)"
}

resource "google_service_account" "indexer" {
  account_id   = "slack-rag-indexer"
  display_name = "Slack RAG Bot Indexer (Cloud Run Job)"
}

# Agent: access Slack secrets and database URL
resource "google_secret_manager_secret_iam_member" "agent_slack_bot_token" {
  secret_id  = google_secret_manager_secret.slack_bot_token.id
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.agent.email}"
}

resource "google_secret_manager_secret_iam_member" "agent_slack_signing" {
  secret_id  = google_secret_manager_secret.slack_signing_secret.id
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.agent.email}"
}

resource "google_secret_manager_secret_iam_member" "agent_database_url" {
  secret_id  = google_secret_manager_secret.database_url.id
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.agent.email}"
}

resource "google_secret_manager_secret_iam_member" "agent_github_token" {
  secret_id  = google_secret_manager_secret.github_token.id
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.agent.email}"
}

# Indexer job: access secrets for ensureSecrets fallback (fetches all if env not set)
resource "google_secret_manager_secret_iam_member" "indexer_slack_bot_token" {
  secret_id  = google_secret_manager_secret.slack_bot_token.id
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.indexer.email}"
}

resource "google_secret_manager_secret_iam_member" "indexer_slack_signing" {
  secret_id  = google_secret_manager_secret.slack_signing_secret.id
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.indexer.email}"
}

resource "google_secret_manager_secret_iam_member" "indexer_database_url" {
  secret_id  = google_secret_manager_secret.database_url.id
  role       = "roles/secretmanager.secretAccessor"
  member     = "serviceAccount:${google_service_account.indexer.email}"
}

# Scheduler invokes Cloud Run Job: use default compute SA or a dedicated one
# Cloud Scheduler needs run.invoker on the JOB (not the service account that runs the job)
# We'll grant the default compute SA permission to run the job
resource "google_cloud_run_v2_job_iam_member" "scheduler_invoker" {
  name     = google_cloud_run_v2_job.indexer.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.project_number}-compute@developer.gserviceaccount.com"
}
