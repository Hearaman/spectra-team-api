import { pool } from "./db";
import { emit } from "./events";

export interface TeamInput {
  name: string;
  slug: string;
  description?: string;
  ownerEmail: string;
  githubTeam?: string;
  environments?: string[];   // e.g. ["dev", "prod"]
  resourceTier?: string;     // e.g. "small" | "medium" | "large"
}

export async function listTeams() {
  const { rows } = await pool.query(`SELECT * FROM teams ORDER BY created_at`);
  return rows;
}

export async function getTeam(slug: string) {
  const { rows } = await pool.query(`SELECT * FROM teams WHERE slug = $1`, [slug]);
  return rows[0] ?? null;
}

// Onboard a team. The write + the event happen in ONE transaction (outbox).
export async function createTeam(input: TeamInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO teams
         (slug, name, description, owner_email, github_team, environments, resource_tier)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.slug,
        input.name,
        input.description ?? "",
        input.ownerEmail,
        input.githubTeam ?? null,
        JSON.stringify(input.environments ?? ["dev"]),
        input.resourceTier ?? "small",
      ]
    );
    const team = rows[0];
    await emit("new_team", team.slug, team, client);   // same transaction
    await client.query("COMMIT");
    return team;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateTeam(slug: string, patch: Partial<TeamInput>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT * FROM teams WHERE slug=$1 FOR UPDATE`, [slug]);
    if (found.rowCount === 0) { await client.query("ROLLBACK"); return null; }
    const cur = found.rows[0];
    const { rows } = await client.query(
      `UPDATE teams SET
         name = $2, description = $3, owner_email = $4, github_team = $5,
         environments = $6, resource_tier = $7, updated_at = now()
       WHERE slug = $1 RETURNING *`,
      [
        slug,
        patch.name ?? cur.name,
        patch.description ?? cur.description,
        patch.ownerEmail ?? cur.owner_email,
        patch.githubTeam ?? cur.github_team,
        JSON.stringify(patch.environments ?? cur.environments),
        patch.resourceTier ?? cur.resource_tier,
      ]
    );
    const team = rows[0];
    await emit("updated_team", slug, team, client);
    await client.query("COMMIT");
    return team;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Provisioning report written back by the namespace-controller.
export interface ProvisionStatusInput {
  status: string;                 // "provisioned" | "error" | "offboarded"
  resources?: unknown[];          // [{ kind, name, namespace, environment }, ...]
  message?: string | null;
}

// Record what the control plane has actually provisioned for a team. This is a
// status-only write (it never touches desired-state columns) and does NOT emit
// an event — otherwise the controller's own report would trigger another
// reconcile, looping forever. Returns the updated row, or null if unknown slug.
export async function setProvisionStatus(slug: string, input: ProvisionStatusInput) {
  const { rows } = await pool.query(
    `UPDATE teams SET
       provision_status      = $2,
       provisioned_resources = $3,
       provision_message     = $4,
       last_reconciled_at    = now()
     WHERE slug = $1
     RETURNING *`,
    [
      slug,
      input.status,
      JSON.stringify(input.resources ?? []),
      input.message ?? null,
    ]
  );
  return rows[0] ?? null;
}

export async function deleteTeam(slug: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount, rows } = await client.query(
      `DELETE FROM teams WHERE slug=$1 RETURNING *`, [slug]
    );
    if (rowCount === 0) { await client.query("ROLLBACK"); return false; }
    await emit("deleted_team", slug, rows[0], client);
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
