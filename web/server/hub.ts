/**
 * In-process pub/sub for broadcasting server-side events to all connected
 * WebSocket clients. Single-process MVP; no Redis, no replication.
 */

import type { ServerMessage } from "../shared/protocol.ts";

type Sender = (raw: string) => void;

const senders = new Set<Sender>();

export function registerSender(send: Sender): () => void {
  senders.add(send);
  return () => {
    senders.delete(send);
  };
}

export function broadcast(msg: ServerMessage): void {
  const raw = JSON.stringify(msg);
  for (const send of senders) {
    try {
      send(raw);
    } catch {
      // The send fn is expected to handle its own errors / closed states.
    }
  }
}
