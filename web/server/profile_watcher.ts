/**
 * Per-session watcher for `<repoPath>/range.yaml`.
 *
 * Whenever the file changes (scaffold-accept writes it, the agent
 * edits it via apply_patch, the user edits it in VS Code), this
 * broadcasts a `profile_changed` server message so connected clients
 * can re-fetch the profile and refresh their slash picker / scenario
 * list.
 *
 * Watches the parent directory (not the file directly) so creation
 * events also fire — fs.watch on a missing path throws.
 */

import { watch as fsWatch, type FSWatcher } from "node:fs";

import { broadcast } from "./hub.ts";
import { log } from "./log.ts";

interface Entry {
  watcher: FSWatcher;
  /** Debounce timer — fs.watch fires several events per save. */
  timer: ReturnType<typeof setTimeout> | null;
}

const watchers = new Map<string, Entry>();

export function watchProfile(sessionId: string, repoPath: string): void {
  if (watchers.has(sessionId)) return;

  let watcher: FSWatcher;
  try {
    watcher = fsWatch(
      repoPath,
      { persistent: false },
      (_event, filename) => {
        if (filename !== "range.yaml") return;
        const entry = watchers.get(sessionId);
        if (!entry) return;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          entry.timer = null;
          broadcast({
            type: "profile_changed",
            sessionId,
            t: Date.now(),
          });
          log.info("profile_watcher", "broadcast profile_changed", {
            sessionId,
          });
        }, 150);
      },
    );
  } catch (err) {
    log.warn("profile_watcher", "failed to start watch", {
      sessionId,
      repoPath,
      err: String(err instanceof Error ? err.message : err),
    });
    return;
  }

  watcher.on("error", (err) => {
    log.warn("profile_watcher", "watcher error", {
      sessionId,
      err: String(err instanceof Error ? err.message : err),
    });
  });

  watchers.set(sessionId, { watcher, timer: null });
  log.info("profile_watcher", "started", { sessionId, repoPath });
}

export function unwatchProfile(sessionId: string): void {
  const entry = watchers.get(sessionId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  try {
    entry.watcher.close();
  } catch {
    // best effort
  }
  watchers.delete(sessionId);
}

export function shutdownAllProfileWatchers(): void {
  for (const sid of [...watchers.keys()]) {
    unwatchProfile(sid);
  }
}
