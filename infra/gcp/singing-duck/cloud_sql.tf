# Cloud SQL for PostgreSQL with pgvector
resource "random_password" "db_password" {
  length  = 24
  special = true
}

resource "random_password" "postgres_password" {
  length  = 24
  special = true
}

resource "google_sql_database_instance" "main" {
  name             = "slack-rag-db"
  database_version = "POSTGRES_15"
  region           = var.region
  depends_on       = [google_service_networking_connection.private_vpc_connection]

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_size         = 10
    disk_type         = "PD_SSD"

    ip_configuration {
      ipv4_enabled    = true   # Required for Cloud SQL Proxy from laptop (enable-pgvector.sh)
      private_network = data.google_compute_network.default.id  # Cloud Run uses private IP via VPC
      require_ssl     = true   # Enforce SSL (satisfies SCC). Note: provider warns deprecated; ssl_mode=ENCRYPTED_ONLY causes 400 for Postgres.
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = false
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
      }
    }

    insights_config {
      query_insights_enabled = true
    }
  }

  deletion_protection = false

  lifecycle {
    ignore_changes = [
      settings[0].ip_configuration  # SSL/connection settings; manage in GCP Console to avoid 400 on apply
    ]
  }
}

resource "google_sql_database" "db" {
  name     = var.db_name
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app_user" {
  name     = var.db_user
  instance = google_sql_database_instance.main.name
  password = random_password.db_password.result
}

resource "google_sql_user" "postgres" {
  name     = "postgres"
  instance = google_sql_database_instance.main.name
  password = random_password.postgres_password.result
}

# Enable pgvector extension (run once after DB exists); see outputs.tf and README.
# DATABASE_URL is stored in Secret Manager (secret database-url).
