/**
 * Range MVP server — Phase 1 foundation + sessions.
 *
 * Bun + Hono.
 * - GET  /api/health
 * - GET  /api/sessions
 * - GET  /api/sessions/:id
 * - POST /api/sessions
 * - GET  /ws                (WebSocket: events + pings)
 */

import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { log } from "./log.ts";
import type {
  ServerMessage,
  CreateSessionRequest,
  CreateSessionResponse,
  GetSessionResponse,
  ListSessionsResponse,
} from "../shared/protocol.ts";
import "./db.ts";
import { createSession, getSession, listSessions } from "./sessions.ts";
import { broadcast, registerSender } from "./hub.ts";

const VERSION = "0.1.0";
const PORT = Number(Bun.env.RANGE_PORT ?? 3457);

const { upgradeWebSocket, websocket } =
  createBunWebSocket<ServerWebSocket>();

const app = new Hono();

// ─── Health ────────────────────────────────────────────────────────────────

app.get("/api/health", (c) =>
  c.json({ ok: true, server: "range", version: VERSION, t: Date.now() }),
);

// ─── Sessions ──────────────────────────────────────────────────────────────

const VALID_KINDS = new Set<CreateSessionRequest["kind"]>([
  "tracked_task",
  "freeform",
  "pr_verification",
]);

app.post("/api/sessions", async (c) => {
  let body: CreateSessionRequest;
  try {
    body = (await c.req.json()) as CreateSessionRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object" || !VALID_KINDS.has(body.kind)) {
    return c.json({ error: "kind must be one of tracked_task | freeform | pr_verification" }, 400);
  }

  const session = createSession(body);
  log.info("sessions", "created", { id: session.id, kind: session.kind });

  broadcast({ type: "session_created", session });

  const response: CreateSessionResponse = { session };
  return c.json(response, 201);
});

app.get("/api/sessions", (c) => {
  const sessions = listSessions(50);
  const response: ListSessionsResponse = { sessions };
  return c.json(response);
});

app.get("/api/sessions/:id", (c) => {
  const id = c.req.param("id");
  const session = getSession(id);
  if (!session) return c.json({ error: "session not found" }, 404);
  const response: GetSessionResponse = { session };
  return c.json(response);
});

// ─── WebSocket ─────────────────────────────────────────────────────────────

const PING_INTERVAL_MS = 5_000;

app.get(
  "/ws",
  upgradeWebSocket(() => {
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let unregister: (() => void) | null = null;

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

        unregister = registerSender((raw) => ws.send(raw));

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
        if (unregister) {
          unregister();
          unregister = null;
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

// ─── Static (production) ───────────────────────────────────────────────────

if (Bun.env.RANGE_ENV === "production") {
  app.get("/*", async (c) => {
    const url = new URL(c.req.url);
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`./dist/web${filePath}`);
    if (await file.exists()) {
      return new Response(file);
    }
    return new Response(Bun.file("./dist/web/index.html"));
  });
}

// ─── Boot ──────────────────────────────────────────────────────────────────

const server = Bun.serve({
  fetch: app.fetch,
  websocket,
  port: PORT,
  hostname: "127.0.0.1",
});

log.info(
  "server",
  `range listening on http://${server.hostname}:${server.port}`,
);

process.on("SIGINT", () => {
  log.info("server", "SIGINT received, stopping");
  server.stop();
  process.exit(0);
});
