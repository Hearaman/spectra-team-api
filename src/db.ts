import { Pool } from "pg";

// One shared connection pool to PostgreSQL.
// DATABASE_URL comes from the Kubernetes Secret (see k8s/teams-api-secret.yaml).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// The authoritative store.
//   teams       -> the single source of truth: who the platform's teams are.
//   team_events -> the "outbox" / event stream that other controllers read.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  slug          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  owner_email   TEXT NOT NULL,
  github_team   TEXT,
  environments  JSONB NOT NULL DEFAULT '["dev"]',
  resource_tier TEXT NOT NULL DEFAULT 'small',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Provisioning status, written back by the namespace-controller after it
-- reconciles a team into the cluster. The 'status' column above is the team's
-- *desired* lifecycle state (active/offboarded); these columns report what the
-- control plane has *actually* provisioned, so the portal can show the truth.
--   provision_status     -> 'pending' until the controller first reports;
--                           then 'provisioned' | 'error' | 'offboarded'.
--   provisioned_resources-> the concrete namespaces/quotas/rolebindings that exist.
--   provision_message    -> last error detail, if any.
--   last_reconciled_at   -> when the controller last reported, for staleness.
-- ADD COLUMN IF NOT EXISTS keeps this migration safe on an existing table.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS provision_status      TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS provisioned_resources JSONB NOT NULL DEFAULT '[]';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS provision_message     TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS last_reconciled_at    TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS team_events (
  id          BIGSERIAL PRIMARY KEY,
  event_type  TEXT NOT NULL,
  team_slug   TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function migrate() {
  await pool.query(SCHEMA);
  console.log("[db] schema ready");
}
