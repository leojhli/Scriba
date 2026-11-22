import type { ExtPing } from "wasp/server/api";
import { checkDemoKey } from "./demoKey";

export const extPing: ExtPing = (req, res) => {
  if (!checkDemoKey(req, res)) return;
  res.json({ ok: true });
};
