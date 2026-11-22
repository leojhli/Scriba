import express from "express";
import type { MiddlewareConfigFn, ServerSetupFn } from "wasp/server";
import { DATA_DIR } from "./paths";

/** Serves data/{videoId}/dialogue.mp3, audio.mp3 and explain-{t}.mp3 at /media/... */
export const setup: ServerSetupFn = async ({ app }) => {
  app.use(
    "/media",
    (_req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-cache");
      next();
    },
    express.static(DATA_DIR, { dotfiles: "deny", index: false }),
  );
  console.log(`[setup] serving /media from ${DATA_DIR}`);
};

/** Shadowing uploads base64 audio, so raise the JSON body limit from 100 kb. */
export const serverMiddleware: MiddlewareConfigFn = (config) => {
  config.set("express.json", express.json({ limit: "25mb" }));
  return config;
};
