# ECR repository for slack-rag-bot image
resource "aws_ecr_repository" "agent" {
  name                 = "slack-rag-bot"
  image_tag_mutability = "MUTABLE"
  tags                 = { Name = "${local.name_prefix}-agent" }
}
