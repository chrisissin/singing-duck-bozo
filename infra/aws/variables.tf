variable "region" {
  type        = string
  description = "AWS region for resources"
  default     = "us-east-1"
}

variable "db_name" {
  type        = string
  description = "PostgreSQL database name"
  default     = "slack_rag"
}

variable "db_user" {
  type        = string
  description = "PostgreSQL user name"
  default     = "slack_rag_app"
}

variable "db_instance_class" {
  type        = string
  description = "RDS instance class (e.g. db.t3.micro)"
  default     = "db.t3.micro"
}

variable "indexer_schedule" {
  type        = string
  description = "EventBridge schedule for indexer (cron)"
  default     = "rate(30 minutes)"
}

variable "agent_image" {
  type        = string
  description = "ECR image URI for slack-rag-bot (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/slack-rag-bot:latest)"
  default     = ""
}

variable "ollama_base_url" {
  type        = string
  description = "Ollama URL when not creating managed service"
  default     = ""
}

variable "create_ollama_service" {
  type        = bool
  description = "Create Ollama as ECS service"
  default     = true
}

variable "ollama_cpu" {
  type        = number
  description = "Ollama task CPU units (1024 = 1 vCPU)"
  default     = 4096
}

variable "ollama_memory" {
  type        = number
  description = "Ollama task memory (MB)"
  default     = 8192
}

variable "ollama_num_parallel" {
  type        = number
  description = "Max parallel Ollama requests (helps avoid 429 when embedding + chat run concurrently)"
  default     = 4
}

variable "ollama_max_loaded_models" {
  type        = number
  description = "Max loaded models (2 for nomic-embed-text + tinyllama)"
  default     = 2
}
