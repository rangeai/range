import type {
  CreateSessionRequest,
  CreateSessionResponse,
  GetSessionResponse,
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
