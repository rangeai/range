import type {
  CreateAttemptRequest,
  CreateAttemptResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  GetAttemptResponse,
  GetSessionResponse,
  ListAttemptsResponse,
  ListSessionsResponse,
} from "@shared/protocol";

async function jsonRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as T;
}

// ─── Sessions ─────────────────────────────────────────────────────────────

export function createSession(
  body: CreateSessionRequest,
): Promise<CreateSessionResponse> {
  return jsonRequest<CreateSessionResponse>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listSessions(): Promise<ListSessionsResponse> {
  return jsonRequest<ListSessionsResponse>("/api/sessions");
}

export function getSession(id: string): Promise<GetSessionResponse> {
  return jsonRequest<GetSessionResponse>(
    `/api/sessions/${encodeURIComponent(id)}`,
  );
}

// ─── Attempts ─────────────────────────────────────────────────────────────

export function listAttempts(
  sessionId: string,
): Promise<ListAttemptsResponse> {
  return jsonRequest<ListAttemptsResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/attempts`,
  );
}

export function createAttempt(
  sessionId: string,
  body: CreateAttemptRequest,
): Promise<CreateAttemptResponse> {
  return jsonRequest<CreateAttemptResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/attempts`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getAttempt(id: string): Promise<GetAttemptResponse> {
  return jsonRequest<GetAttemptResponse>(
    `/api/attempts/${encodeURIComponent(id)}`,
  );
}

export function promoteAttempt(
  id: string,
): Promise<{ attempt: GetAttemptResponse["attempt"] }> {
  return jsonRequest(`/api/attempts/${encodeURIComponent(id)}/promote`, {
    method: "POST",
  });
}
