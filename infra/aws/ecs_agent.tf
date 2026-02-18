# ECS task definition and service for slack-rag-bot (agent)
resource "aws_cloudwatch_log_group" "agent" {
  name              = "/ecs/${local.name_prefix}-agent"
  retention_in_days = 7
}

resource "aws_ecs_task_definition" "agent" {
  family                   = "${local.name_prefix}-agent"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "2048"

  execution_role_arn = aws_iam_role.ecs_task_execution.arn
  task_role_arn      = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "agent"
    image     = local.agent_image
    essential = true
    portMappings = [{
      containerPort = 8080
      protocol      = "tcp"
    }]
    environment = [
      { name = "OLLAMA_BASE_URL", value = local.ollama_url },
      { name = "OLLAMA_CHAT_MODEL", value = "tinyllama" },
      { name = "OLLAMA_EMBED_MODEL", value = "nomic-embed-text" },
      { name = "OLLAMA_MODEL", value = "tinyllama" },
      { name = "PORT", value = "8080" }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
      { name = "SLACK_BOT_TOKEN", valueFrom = aws_secretsmanager_secret.slack_bot_token.arn },
      { name = "SLACK_SIGNING_SECRET", valueFrom = aws_secretsmanager_secret.slack_signing_secret.arn },
      { name = "GITHUB_TOKEN", valueFrom = aws_secretsmanager_secret.github_token.arn }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.agent.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "agent" {
  name            = "${local.name_prefix}-agent"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.agent.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.agent.arn
    container_name   = "agent"
    container_port   = 8080
  }
}
