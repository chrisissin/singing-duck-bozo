# Secret Manager: placeholders for Slack tokens; DB URL from Cloud SQL
resource "google_secret_manager_secret" "slack_bot_token" {
  secret_id = "slack-bot-token"
  depends_on = [google_project_service.secretmanager]

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "slack_bot_token_placeholder" {
  secret      = google_secret_manager_secret.slack_bot_token.id
  secret_data = "replace-me-with-real-slack-bot-token"
}

resource "google_secret_manager_secret" "slack_signing_secret" {
  secret_id = "slack-signing-secret"
  depends_on = [google_project_service.secretmanager]

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "slack_signing_secret_placeholder" {
  secret      = google_secret_manager_secret.slack_signing_secret.id
  secret_data = "replace-me-with-real-slack-signing-secret"
}

# Database URL secret (populated from Cloud SQL)
resource "google_secret_manager_secret" "database_url" {
  secret_id = "database-url"
  depends_on = [google_project_service.secretmanager]

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgresql://${var.db_user}:${urlencode(random_password.db_password.result)}@${google_sql_database_instance.main.private_ip_address}:5432/${var.db_name}?sslmode=require"
}

# GitHub token for create_scaling_schedule_pr (MCP tool)
resource "google_secret_manager_secret" "github_token" {
  secret_id = "github-token"
  depends_on = [google_project_service.secretmanager]

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "github_token_placeholder" {
  secret      = google_secret_manager_secret.github_token.id
  secret_data = "replace-me-with-real-github-token"
}

# Postgres superuser password (for enable-pgvector.sh; postgres can CREATE EXTENSION)
resource "google_secret_manager_secret" "postgres_password" {
  secret_id = "postgres-password"
  depends_on = [google_project_service.secretmanager]

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "postgres_password" {
  secret      = google_secret_manager_secret.postgres_password.id
  secret_data = random_password.postgres_password.result
}
