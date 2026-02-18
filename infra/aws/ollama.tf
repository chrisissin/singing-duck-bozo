# Ollama ECS service (optional)
resource "aws_lb" "ollama" {
  count              = var.create_ollama_service ? 1 : 0
  name               = "${local.name_prefix}-ollama-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.ollama_alb[0].id]
  subnets            = aws_subnet.public[*].id
  tags               = { Name = "${local.name_prefix}-ollama-alb" }
}

resource "aws_lb_target_group" "ollama" {
  count       = var.create_ollama_service ? 1 : 0
  name        = "${local.name_prefix}-ollama-tg"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 10
    interval            = 30
  }
}

resource "aws_lb_listener" "ollama" {
  count             = var.create_ollama_service ? 1 : 0
  load_balancer_arn = aws_lb.ollama[0].arn
  port              = "80"
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ollama[0].arn
  }
}
