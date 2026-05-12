/**
 * Wire protocol shared between server and browser.
 *
 * Kept deliberately small for Phase 1. Will grow as we implement
 * sessions, attempts, runs, evidence streaming, and permission flow.
 */

export interface ServerHello {
  type: "hello";
  server: "range";
  version: string;
  serverTime: number;
}

export interface ServerPing {
  type: "ping";
  t: number;
}

export interface ClientPong {
  type: "pong";
  t: number;
}

export type ServerMessage = ServerHello | ServerPing;
export type ClientMessage = ClientPong;
