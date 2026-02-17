#!/usr/bin/env bash
# Create the GCP project (if it doesn't exist), optionally link billing, then run Terraform init and apply.
# Usage:
#   ./create-project-and-apply.sh [project_id]
#   GCP_PROJECT_ID=my-project BILLING_ACCOUNT_ID=xxx-xxx-xxx ./create-project-and-apply.sh
#
# Prerequisites: gcloud installed and logged in (gcloud auth login).
set -e

PROJECT_ID="${GCP_PROJECT_ID:-${1:-singing-duck}}"
PROJECT_NAME="${GCP_PROJECT_NAME:-Singing Duck}"
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-000000-000000-000000}"
TF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Create project and apply Terraform ==="
echo "Project ID: $PROJECT_ID"
echo "Terraform dir: $TF_DIR"
echo ""

# 0. Ensure Application Default Credentials (Terraform uses these, not gcloud user account)
if ! gcloud auth application-default print-access-token &>/dev/null; then
  echo "Application Default Credentials not set. Terraform needs these."
  echo "Run: gcloud auth application-default login"
  exit 1
fi

# 1. Create project if it doesn't exist
FRESH_PROJECT=false
if ! gcloud projects describe "$PROJECT_ID" &>/dev/null; then
  echo "Creating project: $PROJECT_ID ($PROJECT_NAME)"
  gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME"
  echo "Project created."
  FRESH_PROJECT=true
else
  echo "Project $PROJECT_ID already exists."
fi

# 1b. If fresh project, clear Terraform state (state may reference a deleted/old project)
if [[ "$FRESH_PROJECT" == "true" ]] && [[ -f "$TF_DIR/terraform.tfstate" ]]; then
  echo "Clearing stale Terraform state (fresh project setup)..."
  rm -f "$TF_DIR/terraform.tfstate" "$TF_DIR/terraform.tfstate.backup"
fi

# 1c. If state references a different project (e.g. deleted), clear it
if [[ -f "$TF_DIR/terraform.tfstate" ]]; then
  STATE_PROJECT=$(grep -oE 'projects/[a-z0-9-]+/' "$TF_DIR/terraform.tfstate" 2>/dev/null | head -1 | sed 's|projects/||;s|/||')
  if [[ -n "$STATE_PROJECT" && "$STATE_PROJECT" != "$PROJECT_ID" ]]; then
    echo "Terraform state references project '$STATE_PROJECT', target is '$PROJECT_ID'. Clearing stale state..."
    rm -f "$TF_DIR/terraform.tfstate" "$TF_DIR/terraform.tfstate.backup"
  fi
fi

# 2. Link billing account (required for Cloud Run, Cloud SQL, etc.)
if [[ -n "$BILLING_ACCOUNT_ID" ]]; then
  echo "Linking billing account: $BILLING_ACCOUNT_ID"
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID" 2>/dev/null || true
  echo "Billing linked (or already linked)."
else
  echo "No BILLING_ACCOUNT_ID set. If this is a new project, link billing before apply:"
  echo "  gcloud billing accounts list"
  echo "  export BILLING_ACCOUNT_ID=XXXXX-XXXXX-XXXXX"
  echo "  gcloud billing projects link $PROJECT_ID --billing-account=\$BILLING_ACCOUNT_ID"
  echo ""
  read -p "Continue without billing? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# 2b. Enable required APIs before Terraform (avoids propagation delays during apply)
echo "Enabling required APIs (Compute, Run, VPC Access, Service Networking, etc.)..."
for api in compute.googleapis.com run.googleapis.com vpcaccess.googleapis.com servicenetworking.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com cloudbuild.googleapis.com; do
  gcloud services enable "$api" --project="$PROJECT_ID" 2>/dev/null || true
done
echo "Waiting 60s for API propagation..."
sleep 60

# 3. Set default project and verify access (Terraform uses ADC; gcloud uses a different account)
gcloud config set project "$PROJECT_ID"
TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null)
HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "https://cloudresourcemanager.googleapis.com/v1/projects/$PROJECT_ID" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Application Default Credentials cannot access project $PROJECT_ID (HTTP $HTTP_CODE)."
  echo "Run: gcloud auth application-default login"
  echo "Use the SAME Google account that owns or has Editor/Owner on the project."
  exit 1
fi

# 4. Terraform init and apply
cd "$TF_DIR"
export GCP_PROJECT_ID="$PROJECT_ID"

terraform init -upgrade
terraform plan -var="project_id=$PROJECT_ID" -out=tfplan
terraform apply tfplan

echo ""
echo "=== Done ==="
echo "Next: set Slack secrets, enable pgvector, then run deploy.sh (see Terraform output 'next_steps')."
