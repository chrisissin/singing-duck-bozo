# EventBridge rule to run indexer on schedule
resource "aws_iam_role" "eventbridge_ecs" {
  name = "${local.name_prefix}-eventbridge-ecs"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "eventbridge_run_task" {
  name   = "${local.name_prefix}-eventbridge-run-task"
  role   = aws_iam_role.eventbridge_ecs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ecs:RunTask"
      ]
      Resource = [aws_ecs_task_definition.indexer.arn]
    }, {
      Effect = "Allow"
      Action = "iam:PassRole"
      Resource = [
        aws_iam_role.ecs_task_execution.arn,
        aws_iam_role.ecs_task.arn
      ]
    }]
  })
}

resource "aws_cloudwatch_event_rule" "indexer" {
  name                = "${local.name_prefix}-indexer-schedule"
  description         = "Run Slack RAG indexer"
  schedule_expression = var.indexer_schedule
}

resource "aws_cloudwatch_event_target" "indexer" {
  rule      = aws_cloudwatch_event_rule.indexer.name
  target_id = "indexer"
  arn       = aws_ecs_cluster.main.arn
  role_arn  = aws_iam_role.eventbridge_ecs.arn

  ecs_target {
    task_count          = 1
    task_definition_arn = aws_ecs_task_definition.indexer.arn
    launch_type         = "FARGATE"
    network_configuration {
      subnets          = aws_subnet.private[*].id
      security_groups  = [aws_security_group.ecs_tasks.id]
      assign_public_ip = false
    }
  }
}
