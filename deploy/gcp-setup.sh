#!/usr/bin/env bash
# One-time Google Cloud setup for "Hire the agent" (web/ on Cloud Run).
#
# These are the exact commands that built the live demo. Run once, as a Google
# Cloud user who can create projects and link billing. CI logs in with
# GitHub's OIDC token (Workload Identity Federation), so no Google key is ever
# created. The Token Factory key goes from your environment straight into
# Secret Manager and is never written to a file.
#
#   NEBIUS_API_KEY=... PROJECT_ID=my-agent BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX \
#   GITHUB_REPO=you/slash-agent bash deploy/gcp-setup.sh
#
# Then put the printed project number into .github/workflows/deploy.yml
# (workload_identity_provider) and push to main.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-slash-agent-demo}"
REGION="${REGION:-us-central1}"                  # a Cloud Run free-tier region
BILLING_ACCOUNT="${BILLING_ACCOUNT:?set BILLING_ACCOUNT}"
GITHUB_REPO="${GITHUB_REPO:-Wolfe-Jam/slash-agent}"
BUDGET_USD="${BUDGET_USD:-5}"
BUCKET="${BUCKET:-$PROJECT_ID-spend}"            # daily spend counter
ORG_ID="${ORG_ID:-}"                             # optional: create under an organization
: "${NEBIUS_API_KEY:?set NEBIUS_API_KEY (a Token Factory key)}"

say() { printf '\n== %s\n' "$*"; }
try() { "$@" 2>&1 | grep -v -E 'already exists|ALREADY_EXISTS' || true; }

say "Project and billing"
try gcloud projects create "$PROJECT_ID" ${ORG_ID:+--organization="$ORG_ID"}
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud config set project "$PROJECT_ID" >/dev/null

say "APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com monitoring.googleapis.com billingbudgets.googleapis.com

say "Budget alert (\$$BUDGET_USD, emails at 50% and 100%)"
try gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
  --display-name="$PROJECT_ID safety net" --budget-amount="${BUDGET_USD}USD" \
  --filter-projects="projects/$PROJECT_ID" \
  --threshold-rule=percent=0.5 --threshold-rule=percent=1.0 --billing-project="$PROJECT_ID"

say "Image registry (keeps the latest 3 images)"
try gcloud artifacts repositories create slash --repository-format=docker --location="$REGION"
cat > /tmp/ar-cleanup.json <<'JSON'
[{"name":"keep-latest-3","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":3}},
 {"name":"delete-older","action":{"type":"Delete"},"condition":{"tagState":"any","olderThan":"86400s"}}]
JSON
gcloud artifacts repositories set-cleanup-policies slash --location="$REGION" --policy=/tmp/ar-cleanup.json --no-dry-run >/dev/null

say "Identities: a CI deployer, and the app's runtime"
try gcloud iam service-accounts create github-deployer --display-name="GitHub Actions deployer (main only)"
try gcloud iam service-accounts create agent-web --display-name="Cloud Run runtime for the agent demo"
DEPLOYER="github-deployer@$PROJECT_ID.iam.gserviceaccount.com"
RUNTIME="agent-web@$PROJECT_ID.iam.gserviceaccount.com"

say "Keyless login: trust only $GITHUB_REPO on main"
try gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
try gcloud iam workload-identity-pools providers create-oidc github-com --location=global \
  --workload-identity-pool=github --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='$GITHUB_REPO' && assertion.ref=='refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" --role=roles/iam.workloadIdentityUser --condition=None \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$GITHUB_REPO" >/dev/null

say "Least privilege for the deployer"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOYER" --role=roles/run.admin --condition=None >/dev/null
gcloud artifacts repositories add-iam-policy-binding slash --location="$REGION" --member="serviceAccount:$DEPLOYER" --role=roles/artifactregistry.writer >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" --member="serviceAccount:$DEPLOYER" --role=roles/iam.serviceAccountUser --condition=None >/dev/null

say "The Token Factory key, readable only by the app"
printf '%s' "$NEBIUS_API_KEY" | try gcloud secrets create nebius-api-key --data-file=- --replication-policy=automatic
gcloud secrets add-iam-policy-binding nebius-api-key --member="serviceAccount:$RUNTIME" --role=roles/secretmanager.secretAccessor >/dev/null

say "Daily spend counter (private bucket, the app only)"
try gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$RUNTIME" --role=roles/storage.objectAdmin >/dev/null

say "Check: public access must be allowed for the page"
gcloud resource-manager org-policies describe iam.allowedPolicyMemberDomains --project="$PROJECT_ID" --effective

say "Done. Project number: $PROJECT_NUMBER (set SPEND_BUCKET=$BUCKET in deploy.yml)"
echo "After the first deploy, add the uptime check:"
echo "  gcloud monitoring uptime create agent-web-health --resource-type=uptime-url \\"
echo "    --resource-labels=host=<service host>,project_id=$PROJECT_ID --path=/health \\"
echo "    --protocol=https --period=15 --matcher-content=ok --matcher-type=contains-string"
