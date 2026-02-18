# ECS task definition and service for Ollama
resource "aws_cloudwatch_log_group" "ollama" {
  count             = var.create_ollama_service ? 1 : 0
  name              = "/ecs/${local.name_prefix}-ollama"
  retention_in_days = 7
}

resource "aws_ecs_task_definition" "ollama" {
  count                    = var.create_ollama_service ? 1 : 0
  family                   = "${local.name_prefix}-ollama"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.ollama_cpu)
  memory                   = tostring(var.ollama_memory)

  execution_role_arn = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([{
    name      = "ollama"
    image     = "ollama/ollama:latest"
    essential = true
    portMappings = [{
      containerPort = 8080
      protocol      = "tcp"
    }]
    environment = [
      { name = "OLLAMA_HOST", value = "0.0.0.0:8080" },
      { name = "OLLAMA_KEEP_ALIVE", value = "30m" },
      { name = "OLLAMA_NUM_PARALLEL", value = tostring(var.ollama_num_parallel) },
      { name = "OLLAMA_MAX_LOADED_MODELS", value = tostring(var.ollama_max_loaded_models) }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ollama[0].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "ollama" {
  count           = var.create_ollama_service ? 1 : 0
  name            = "${local.name_prefix}-ollama"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ollama[0].arn
  desired_count   = 1
  launch_type     = "FARGate"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ollama_tasks[0].id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.ollama[0].arn
    container_name   = "ollama"
    container_port   = 8080
  }
}
