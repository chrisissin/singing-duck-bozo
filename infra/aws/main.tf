terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.region
}

locals {
  name_prefix     = "slack-rag"
  agent_image     = var.agent_image != "" ? var.agent_image : "${aws_ecr_repository.agent.repository_url}:latest"
  ollama_url      = var.create_ollama_service ? "http://${aws_lb.ollama[0].dns_name}" : var.ollama_base_url
}
