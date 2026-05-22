import { Request, Response, NextFunction } from "express";

const TOKEN = process.env.API_TOKEN || "";

// Simple shared-secret guard so we can ship Step 4 today.
// Callers must send:  Authorization: Bearer <API_TOKEN>
//
// LATER (book Chapter 4, Exercise 4.4): we replace this with a JWT whose
// claims carry the caller's GitHub teams, validated by an OPA/Rego policy
// that only lets members of the "Managers" team onboard new teams.
// The interface stays the same — we just swap what `requireToken` checks.
export function requireToken(req: Request, res: Response, next: NextFunction) {
  const presented = (req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!TOKEN || presented !== TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
