/** Fetch secrets from Secret Manager if not set (Cloud Run fallback when env injection fails) */
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

let ensured = false;

function debugStatus(envVar, val) {
  if (process.env.DEBUG_SECRETS !== "1") return;
  if (val == null || val === "") console.log("[ensureSecrets] DEBUG", envVar, "= missing/empty");
  else {
    const preview = envVar === "DATABASE_URL" ? ((val.startsWith("postgresql") || val.startsWith("postgres://")) ? "postgresql://..." : "invalid:" + (val.slice(0, 40) || val) + "...") : "len=" + val.length;
    console.log("[ensureSecrets] DEBUG", envVar, "=", preview);
  }
}

export async function ensureSecrets() {
  if (ensured) return;
  const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "singing-duck";
  const client = new SecretManagerServiceClient();
  const secrets = [
    ["DATABASE_URL", "database-url"],
    ["SLACK_BOT_TOKEN", "slack-bot-token"],
    ["SLACK_SIGNING_SECRET", "slack-signing-secret"],
  ];
  const isCloudRun = !!(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB);
  //console.log("[ensureSecrets] Fetching from Secret Manager, project:", projectId, "cloudRun:", isCloudRun);
  for (const [envVar, secretId] of secrets) {
    const current = process.env[envVar];
    debugStatus(envVar, current);
    const dbValid = envVar !== "DATABASE_URL" || (current && (current.startsWith("postgresql") || current.startsWith("postgres://")));
    const forceDbFetch = envVar === "DATABASE_URL" && isCloudRun;
    const needsFetch = forceDbFetch || !current || (typeof current === "string" && (current.trim() === "" || current === "undefined")) || (envVar === "DATABASE_URL" && !dbValid);
    if (needsFetch) {
      const [v] = await client.accessSecretVersion({ name: `projects/${projectId}/secrets/${secretId}/versions/latest` });
      const val = Buffer.from(v.payload.data).toString("utf8").trim();
      if (!val) throw new Error(`Secret ${secretId} is empty`);
      process.env[envVar] = val;
      console.log("[ensureSecrets] Set", envVar, "from", secretId, "(len=" + val.length + ")");
      debugStatus(envVar, val);
    }
  }
  ensured = true;
}
