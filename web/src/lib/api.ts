import type {
  AgentMessageResponse,
  CreateRunRequest,
  CreateRunResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  GetProfileResponse,
  GetRunResponse,
  GetSessionResponse,
  ListRunsResponse,
  ListSessionsResponse,
  StartAgentRequest,
  StartAgentResponse,
  VerificationResult,
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

export function getProfile(sessionId: string): Promise<GetProfileResponse> {
  return jsonRequest<GetProfileResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/profile`,
  );
}

export function getVerification(
  sessionId: string,
): Promise<{ results: VerificationResult[] }> {
  return jsonRequest<{ results: VerificationResult[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/verification`,
  );
}

// ─── Runs ─────────────────────────────────────────────────────────────────

export function listRuns(sessionId: string): Promise<ListRunsResponse> {
  return jsonRequest<ListRunsResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/runs`,
  );
}

export function createRun(
  sessionId: string,
  body: CreateRunRequest,
): Promise<CreateRunResponse> {
  return jsonRequest<CreateRunResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/runs`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getRun(id: string, includeLogs = false): Promise<GetRunResponse> {
  const suffix = includeLogs ? "?logs=1" : "";
  return jsonRequest<GetRunResponse>(
    `/api/runs/${encodeURIComponent(id)}${suffix}`,
  );
}

export function abortRun(id: string): Promise<{ ok: boolean }> {
  return jsonRequest(`/api/runs/${encodeURIComponent(id)}/abort`, {
    method: "POST",
  });
}

// ─── Agent (Codex) ────────────────────────────────────────────────────────

export function startAgent(
  sessionId: string,
  body: StartAgentRequest = {},
): Promise<StartAgentResponse> {
  return jsonRequest<StartAgentResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent/start`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function sendAgentMessage(
  sessionId: string,
  prompt: string,
): Promise<AgentMessageResponse> {
  return jsonRequest<AgentMessageResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent/message`,
    {
      method: "POST",
      body: JSON.stringify({ prompt }),
    },
  );
}

export function stopAgent(sessionId: string): Promise<{ ok: boolean }> {
  return jsonRequest(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent/stop`,
    { method: "POST" },
  );
}

export function getAgentContext(
  sessionId: string,
): Promise<{ baseInstructions: string }> {
  return jsonRequest(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent/context`,
  );
}
