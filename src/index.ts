import express from "express";
import { migrate, pool } from "./db";
import { requireToken } from "./auth";
import { listTeams, getTeam, createTeam, updateTeam, deleteTeam } from "./teams";
import { startSyncLoop } from "./events";

const app = express();
app.use(express.json());

// Health check — no auth. Kubernetes probes hit this.
app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "db-unavailable" });
  }
});

// Everything below the line requires the API token.
app.use(requireToken);

// ---------- Teams: the authoritative CRUD ----------
app.get("/v1/teams", async (_req, res) => {
  res.json(await listTeams());
});

app.get("/v1/teams/:slug", async (req, res) => {
  const team = await getTeam(req.params.slug);
  if (!team) return res.status(404).json({ error: "not found" });
  res.json(team);
});

app.post("/v1/teams", async (req, res) => {
  const { name, slug, ownerEmail } = req.body || {};
  if (!name || !slug || !ownerEmail) {
    return res.status(400).json({ error: "name, slug and ownerEmail are required" });
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "slug must be lowercase letters, numbers and dashes" });
  }
  try {
    const team = await createTeam(req.body);
    res.status(201).json(team);
  } catch (err: any) {
    if (err.code === "23505") return res.status(409).json({ error: "team already exists" });
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

app.patch("/v1/teams/:slug", async (req, res) => {
  const team = await updateTeam(req.params.slug, req.body || {});
  if (!team) return res.status(404).json({ error: "not found" });
  res.json(team);
});

app.delete("/v1/teams/:slug", async (req, res) => {
  const ok = await deleteTeam(req.params.slug);
  if (!ok) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

// ---------- Event stream: subscribers poll here ----------
// The Namespace Controller (Step 5) will call:
//   GET /v1/events?after=<last_id_it_saw>
// and act on every event it hasn't processed yet.
app.get("/v1/events", async (req, res) => {
  const after = Number(req.query.after || 0);
  const { rows } = await pool.query(
    `SELECT * FROM team_events WHERE id > $1 ORDER BY id ASC LIMIT 200`,
    [after]
  );
  res.json(rows);
});

const PORT = Number(process.env.PORT || 8080);

migrate()
  .then(() => {
    startSyncLoop();
    app.listen(PORT, () => console.log(`[teams-api] listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("[teams-api] failed to start", err);
    process.exit(1);
  });
