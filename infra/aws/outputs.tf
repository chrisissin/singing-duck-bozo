output "region" {
  value       = var.region
  description = "AWS region"
}

output "agent_url" {
  value       = "http://${aws_lb.agent.dns_name}"
  description = "Agent service URL — use for Slack Event Subscriptions Request URL"
}

output "ollama_url" {
  value       = var.create_ollama_service ? "http://${aws_lb.ollama[0].dns_name}" : null
  description = "Ollama service URL (when create_ollama_service = true)"
}

output "ecr_repository_url" {
  value       = aws_ecr_repository.agent.repository_url
  description = "ECR repository URL for slack-rag-bot image"
}

output "rds_endpoint" {
  value       = aws_db_instance.main.address
  description = "RDS PostgreSQL endpoint (for pgvector setup)"
}

output "next_steps" {
  value = join("\n", concat([
    "1. Set Slack and GitHub secrets in AWS Secrets Manager:",
    "   aws secretsmanager put-secret-value --secret-id ${aws_secretsmanager_secret.slack_bot_token.name} --secret-string 'xoxb-...'",
    "   aws secretsmanager put-secret-value --secret-id ${aws_secretsmanager_secret.slack_signing_secret.name} --secret-string '...'",
    "   aws secretsmanager put-secret-value --secret-id ${aws_secretsmanager_secret.github_token.name} --secret-string 'ghp_...'",
    "2. Enable pgvector: Connect to RDS and run: CREATE EXTENSION IF NOT EXISTS vector;",
    "3. Build and push image: ./infra/aws/scripts/deploy.sh",
    "4. Configure Slack Event Subscriptions Request URL: http://${aws_lb.agent.dns_name}/slack/events"
  ], var.create_ollama_service ? ["5. Pull models on Ollama: ./infra/aws/scripts/pull-ollama-models.sh"] : []))
  description = "Post-apply steps"
}
