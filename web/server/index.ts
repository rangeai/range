/**
 * Range MVP server — Phase 1 foundation.
 *
 * Bun + Hono. Serves an HTTP endpoint at `/api/health` and a WebSocket
 * endpoint at `/ws`. The frontend connects via the Vite proxy in dev,
 * or directly in production (same origin).
 */

import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { log } from "./log.ts";
import type { ServerMessage } from "../shared/protocol.ts";

const VERSION = "0.1.0";
const PORT = Number(Bun.env.RANGE_PORT ?? 3457);

const { upgradeWebSocket, websocket } =
  createBunWebSocket<ServerWebSocket>();

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({ ok: true, server: "range", version: VERSION, t: Date.now() }),
);

// Per-connection ping cadence. 5s is comfortable; bun's WS is cheap.
const PING_INTERVAL_MS = 5_000;

app.get(
  "/ws",
  upgradeWebSocket(() => {
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    return {
      onOpen: (_event, ws) => {
        log.info("ws", "client connected");

        const hello: ServerMessage = {
          type: "hello",
          server: "range",
          version: VERSION,
          serverTime: Date.now(),
        };
        ws.send(JSON.stringify(hello));

        pingTimer = setInterval(() => {
          const ping: ServerMessage = { type: "ping", t: Date.now() };
          ws.send(JSON.stringify(ping));
        }, PING_INTERVAL_MS);
      },

      onMessage: (event, _ws) => {
        const raw = event.data;
        if (typeof raw !== "string") return;
        try {
          const msg = JSON.parse(raw) as { type?: string };
          log.debug("ws", "message", { type: msg.type });
        } catch {
          log.warn("ws", "non-JSON message", { len: raw.length });
        }
      },

      onClose: () => {
        log.info("ws", "client disconnected");
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
      },

      onError: (event) => {
        log.error("ws", "socket error", {
          err: String((event as ErrorEvent).message ?? event),
        });
      },
    };
  }),
);

// Production: serve built frontend assets from web/dist/web.
// In dev, Vite serves the frontend on :5173 and proxies /api + /ws to us.
if (Bun.env.RANGE_ENV === "production") {
  app.get("/*", async (c) => {
    const url = new URL(c.req.url);
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`./dist/web${filePath}`);
    if (await file.exists()) {
      return new Response(file);
    }
    // SPA fallback: hand back index.html for unknown paths.
    return new Response(Bun.file("./dist/web/index.html"));
  });
}

const server = Bun.serve({
  fetch: app.fetch,
  websocket,
  port: PORT,
  hostname: "127.0.0.1",
});

log.info("server", `range listening on http://${server.hostname}:${server.port}`);

process.on("SIGINT", () => {
  log.info("server", "SIGINT received, stopping");
  server.stop();
  process.exit(0);
});
