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
  OpenPrRequest,
  OpenPrResponse,
  PrDraftResponse,
  RunScenarioResponse,
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

export function deleteSession(id: string): Promise<{ ok: boolean }> {
  return jsonRequest(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function allowCommand(
  sessionId: string,
  binary: string,
): Promise<GetSessionResponse> {
  return jsonRequest<GetSessionResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/allow-command`,
    { method: "POST", body: JSON.stringify({ binary }) },
  );
}

export function disallowCommand(
  sessionId: string,
  binary: string,
): Promise<GetSessionResponse> {
  return jsonRequest<GetSessionResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/allow-command/${encodeURIComponent(binary)}`,
    { method: "DELETE" },
  );
}

export function setAutoApprove(
  sessionId: string,
  enabled: boolean,
): Promise<GetSessionResponse> {
  return jsonRequest<GetSessionResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/auto-approve`,
    { method: "POST", body: JSON.stringify({ enabled }) },
  );
}

export function setSandbox(
  sessionId: string,
  sandbox: import("@shared/protocol").Sandbox,
): Promise<GetSessionResponse> {
  return jsonRequest<GetSessionResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/sandbox`,
    { method: "POST", body: JSON.stringify({ sandbox }) },
  );
}

export function restartAgent(
  sessionId: string,
): Promise<{ threadId: string }> {
  return jsonRequest(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent/restart`,
    { method: "POST" },
  );
}

export function clearAgent(
  sessionId: string,
): Promise<{ threadId: string }> {
  return jsonRequest(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent/clear`,
    { method: "POST" },
  );
}

export function attachRepo(
  sessionId: string,
  repoPath: string,
): Promise<GetSessionResponse> {
  return jsonRequest<GetSessionResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/attach-repo`,
    {
      method: "POST",
      body: JSON.stringify({ repoPath }),
    },
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

export function listRunArtifacts(
  runId: string,
): Promise<{ artifacts: import("@shared/protocol").ArtifactInfo[] }> {
  return jsonRequest(`/api/runs/${encodeURIComponent(runId)}/artifacts`);
}

export function artifactUrl(runId: string, name: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(name)}`;
}

export function runScenario(
  sessionId: string,
  scenarioName: string,
): Promise<RunScenarioResponse> {
  return jsonRequest<RunScenarioResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/scenarios/${encodeURIComponent(scenarioName)}/run`,
    { method: "POST" },
  );
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

export function getAgentHistory(
  sessionId: string,
): Promise<{
  events: import("@shared/protocol").ServerMessage[];
  alive: boolean;
  threadId: string | null;
}> {
  return jsonRequest(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent/history`,
  );
}

// ─── PRs ──────────────────────────────────────────────────────────────────

export function draftPr(sessionId: string): Promise<PrDraftResponse> {
  return jsonRequest<PrDraftResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/pr/draft`,
    { method: "POST" },
  );
}

export function openPr(
  sessionId: string,
  body: OpenPrRequest,
): Promise<OpenPrResponse> {
  return jsonRequest<OpenPrResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/pr/open`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

// ─── FS browser ───────────────────────────────────────────────────────────

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  isGitRepo: boolean;
}

export interface FsListResponse {
  path: string;
  parent: string | null;
  home: string;
  entries: FsEntry[];
}

export function listFs(path?: string): Promise<FsListResponse> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  return jsonRequest<FsListResponse>(`/api/fs/list${qs}`);
}
