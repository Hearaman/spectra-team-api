import { PoolClient } from "pg";
import { pool } from "./db";

// The four things that can happen to a team. Subscribers react to these.
export type EventType =
  | "new_team"
  | "updated_team"
  | "deleted_team"
  | "sync_team";

// Write an event into the outbox.
//
// THE OUTBOX PATTERN: we accept the same DB `client` (transaction) that wrote
// the team. So the team row AND its event are committed together, atomically.
// We can never end up with "team created but no event emitted" (or vice versa).
// That is what makes the event stream RELIABLE.
export async function emit(
  eventType: EventType,
  teamSlug: string,
  payload: unknown,
  client?: PoolClient
) {
  const runner = client ?? pool;
  await runner.query(
    `INSERT INTO team_events (event_type, team_slug, payload) VALUES ($1, $2, $3)`,
    [eventType, teamSlug, JSON.stringify(payload)]
  );
}

// THE BOOK'S 15-MINUTE HEARTBEAT (figure 4.10: "sync_team every 15 min").
// Every 15 minutes we re-announce every active team with a sync_team event.
// Subscribers treat sync_team as: "make the real world match this desired state."
// Result: even if a controller was down and missed a new_team event, reality
// self-heals on the next sync. This is "reconciliation" — the core idea behind
// how Kubernetes controllers stay correct.
const FIFTEEN_MIN = 15 * 60 * 1000;

export function startSyncLoop() {
  setInterval(async () => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM teams WHERE status = 'active'`
      );
      for (const team of rows) {
        await emit("sync_team", team.slug, team);
      }
      console.log(`[sync] emitted sync_team for ${rows.length} team(s)`);
    } catch (err) {
      console.error("[sync] failed", err);
    }
  }, FIFTEEN_MIN);
}
