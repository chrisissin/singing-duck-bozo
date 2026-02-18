# ECS task definition for indexer (scheduled via EventBridge)
resource "aws_cloudwatch_log_group" "indexer" {
  name              = "/ecs/${local.name_prefix}-indexer"
  retention_in_days = 7
}

resource "aws_ecs_task_definition" "indexer" {
  family                   = "${local.name_prefix}-indexer"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"

  execution_role_arn = aws_iam_role.ecs_task_execution.arn
  task_role_arn      = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "indexer"
    image     = local.agent_image
    essential = true
    command   = ["node", "src/indexer/sync_once.js"]
    environment = [
      { name = "OLLAMA_BASE_URL", value = local.ollama_url },
      { name = "OLLAMA_EMBED_MODEL", value = "nomic-embed-text" },
      { name = "SLACK_CHANNEL_DELAY_MS", value = "12000" },
      { name = "SLACK_THREAD_DELAY_MS", value = "2000" }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
      { name = "SLACK_BOT_TOKEN", valueFrom = aws_secretsmanager_secret.slack_bot_token.arn }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.indexer.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}
