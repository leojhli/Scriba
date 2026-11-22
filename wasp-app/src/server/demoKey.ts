import type { Request, Response } from "express";

/**
 * Guards the /ext/* endpoints. The extension sends x-demo-key, which maps every
 * request to the demo user. Returns false (and sends 401) when the key is wrong.
 */
export function checkDemoKey(req: Request, res: Response): boolean {
  const expected = process.env.DEMO_KEY;
  if (!expected || req.header("x-demo-key") !== expected) {
    res.status(401).json({ error: "bad demo key" });
    return false;
  }
  return true;
}
