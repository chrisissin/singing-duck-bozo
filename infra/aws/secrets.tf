# Secrets Manager for Slack tokens and database URL
resource "aws_secretsmanager_secret" "slack_bot_token" {
  name = "${local.name_prefix}/slack-bot-token"
  tags = { Name = "${local.name_prefix}-slack-bot-token" }
}

resource "aws_secretsmanager_secret_version" "slack_bot_token" {
  secret_id     = aws_secretsmanager_secret.slack_bot_token.id
  secret_string = "replace-me-with-real-slack-bot-token"
}

resource "aws_secretsmanager_secret" "slack_signing_secret" {
  name = "${local.name_prefix}/slack-signing-secret"
  tags = { Name = "${local.name_prefix}-slack-signing-secret" }
}

resource "aws_secretsmanager_secret_version" "slack_signing_secret" {
  secret_id     = aws_secretsmanager_secret.slack_signing_secret.id
  secret_string = "replace-me-with-real-slack-signing-secret"
}

# GitHub token for create_scaling_schedule_pr (MCP tool)
resource "aws_secretsmanager_secret" "github_token" {
  name = "${local.name_prefix}/github-token"
  tags = { Name = "${local.name_prefix}-github-token" }
}

resource "aws_secretsmanager_secret_version" "github_token" {
  secret_id     = aws_secretsmanager_secret.github_token.id
  secret_string = "replace-me-with-real-github-token"
}

# Database URL - populated after RDS is available
resource "aws_secretsmanager_secret" "database_url" {
  name = "${local.name_prefix}/database-url"
  tags = { Name = "${local.name_prefix}-database-url" }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://${var.db_user}:${urlencode(random_password.db_password.result)}@${aws_db_instance.main.address}:5432/${var.db_name}?sslmode=require"
  depends_on = [aws_db_instance.main]
}
