# Ollama Cloud Run service (optional; set create_ollama_service = true)
# Listens on PORT 8080 for Cloud Run. Pull models at runtime or pre-bake in custom image.
resource "google_cloud_run_v2_service" "ollama" {
  count    = var.create_ollama_service ? 1 : 0
  name     = "ollama"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  depends_on = [google_project_service.run]

  template {
    # Single instance: Cloud Run uses ephemeral storage per instance. With multiple instances,
    # pulls and requests can hit different instances (models missing). min=max=1 keeps one
    # instance so pull-ollama-models.sh and inference always use the same container.
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
    # Allow embeddings + chat + parser + Web UI to run without 429 (parser chat can take 60s+)
    max_instance_request_concurrency = 6
    timeout                          = "3600s" # 60 min for long inference

    containers {
      image = var.ollama_image

      ports {
        container_port = 8080
      }

      # PORT is set automatically by Cloud Run; do not specify it
      env {
        name  = "OLLAMA_HOST"
        value = "0.0.0.0:8080"
      }
      env {
        name  = "OLLAMA_KEEP_ALIVE"
        value = "30m"
      }
      env {
        name  = "OLLAMA_NUM_PARALLEL"
        value = var.ollama_num_parallel
      }
      env {
        name  = "OLLAMA_MAX_LOADED_MODELS"
        value = var.ollama_max_loaded_models
      }

      command = ["ollama"]
      args    = ["serve"]

      resources {
        limits = {
          cpu    = var.ollama_cpu
          memory = var.ollama_memory
        }
        cpu_idle = false
      }

      startup_probe {
        http_get {
          path = "/"
          port = 8080
        }
        initial_delay_seconds = 10
        timeout_seconds       = 5
        period_seconds        = 10
        failure_threshold     = 6
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

resource "google_cloud_run_v2_service_iam_member" "ollama_public" {
  count    = var.create_ollama_service ? 1 : 0
  name     = google_cloud_run_v2_service.ollama[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Agent needs to call Ollama: grant agent SA permission to invoke Ollama
resource "google_cloud_run_v2_service_iam_member" "agent_invoke_ollama" {
  count    = var.create_ollama_service ? 1 : 0
  name     = google_cloud_run_v2_service.ollama[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.agent.email}"
}
