// Typed client for the Tessera backend. The browser talks only to our own backend.
// No model URL and no API key ever live in frontend code.
import { getBackendConfig } from "@/services/apiConfig";
import type {
  AnalysisResponse,
  AnalysisStatus,
  BackendDiagnosis,
  DocumentOut,
  DocumentPage,
  ExplainPayload,
  GradedAttempt,
  HealthResponse,
  LlmHealthResponse,
  MaterialItem,
  PathBackend,
  ProgressBackend,
  PublicQuiz,
  QuizSummary,
  TutorHistoryTurn,
  TutorResponse,
  UploadResponse,
} from "@/services/apiTypes";

const SESSION_KEY = "tessera.backend.session.v1";
const DEFAULT_TIMEOUT = 20_000;
const LLM_TIMEOUT = 180_000;

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isBackendMode(): boolean {
  return getBackendConfig().configured;
}

function baseUrl(): string {
  return getBackendConfig().baseUrl;
}

export function getStoredSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function storeSessionId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* storage blocked: the in-memory value still works for this page load */
  }
}

export function clearStoredSessionId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

let memoSessionId: string | null = null;
let creating: Promise<string> | null = null;

export async function createSession(): Promise<string> {
  const res = await fetch(`${baseUrl()}/api/sessions`, { method: "POST" });
  if (!res.ok) throw await toError(res);
  const data = (await res.json()) as { session_id: string };
  memoSessionId = data.session_id;
  storeSessionId(data.session_id);
  return data.session_id;
}

export async function ensureSession(forceNew = false): Promise<string> {
  if (forceNew) {
    memoSessionId = null;
    clearStoredSessionId();
  }
  memoSessionId = memoSessionId ?? getStoredSessionId();
  if (memoSessionId) return memoSessionId;
  if (!creating) {
    creating = createSession().finally(() => {
      creating = null;
    });
  }
  return creating;
}

async function toError(res: Response): Promise<ApiClientError> {
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* not JSON */
  }
  const envelope = payload as {
    error?: { code?: string; message?: string; details?: unknown };
  } | null;
  const code = envelope?.error?.code ?? `http_${res.status}`;
  const message = envelope?.error?.message ?? `The backend responded with status ${res.status}.`;
  return new ApiClientError(message, code, res.status, envelope?.error?.details);
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
  withSession?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!isBackendMode()) {
    throw new ApiClientError(
      "No backend is configured. Set VITE_API_BASE_URL to use AI features.",
      "backend_not_configured",
      0,
    );
  }
  const sessionId = options.withSession === false ? null : await ensureSession();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT);
  try {
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(sessionId ? { "X-Session-Id": sessionId } : {}),
      },
      signal: controller.signal,
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    const res = await fetch(`${baseUrl()}${path}`, init);
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiClientError(
        "The backend took too long to respond. Check that it is running and retry.",
        "timeout",
        504,
      );
    }
    throw new ApiClientError(
      `Cannot reach the Tessera backend at ${baseUrl()}. Start it with uvicorn app.main:app --port 8000.`,
      "network_error",
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function uploadDocuments(
  files: File[],
  onProgress?: (percent: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    if (!isBackendMode()) {
      reject(
        new ApiClientError(
          "No backend is configured. Set VITE_API_BASE_URL to upload PDFs.",
          "backend_not_configured",
          0,
        ),
      );
      return;
    }
    void (async () => {
      try {
        const sessionId = await ensureSession();
        const form = new FormData();
        files.forEach((file) => form.append("files", file, file.name));
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${baseUrl()}/api/documents`);
        xhr.setRequestHeader("X-Session-Id", sessionId);
        xhr.timeout = 120_000;
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () => {
          let payload: unknown = null;
          try {
            payload = JSON.parse(xhr.responseText);
          } catch {
            /* ignore */
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(payload as UploadResponse);
            return;
          }
          const envelope = payload as { error?: { code?: string; message?: string } } | null;
          reject(
            new ApiClientError(
              envelope?.error?.message ?? `Upload failed with status ${xhr.status}.`,
              envelope?.error?.code ?? `http_${xhr.status}`,
              xhr.status,
            ),
          );
        };
        xhr.onerror = () =>
          reject(
            new ApiClientError(
              `Cannot reach the Tessera backend at ${baseUrl()}.`,
              "network_error",
              0,
            ),
          );
        xhr.ontimeout = () =>
          reject(new ApiClientError("The upload timed out. Try a smaller PDF.", "timeout", 504));
        xhr.send(form);
      } catch (error) {
        reject(error);
      }
    })();
  });
}

export const api = {
  health: () => request<HealthResponse>("/api/health", { withSession: false }),
  llmHealth: () => request<LlmHealthResponse>("/api/health/llm", { withSession: false }),

  deleteMyData: async (): Promise<void> => {
    const sessionId = await ensureSession();
    await request(`/api/sessions/${sessionId}/data`, { method: "DELETE" });
    memoSessionId = null;
    clearStoredSessionId();
  },

  listDocuments: () => request<DocumentOut[]>("/api/documents"),
  getDocument: (id: string) => request<DocumentOut>(`/api/documents/${id}`),
  getPage: (id: string, page: number) =>
    request<DocumentPage>(`/api/documents/${id}/pages/${page}`),
  deleteDocument: (id: string) =>
    request<{ deleted: boolean; invalidated: Record<string, number>; message: string }>(
      `/api/documents/${id}`,
      { method: "DELETE" },
    ),

  startAnalysis: () =>
    request<AnalysisResponse>("/api/analysis", { method: "POST", timeoutMs: 60_000 }),
  getAnalysis: () => request<AnalysisResponse>("/api/analysis"),
  getAnalysisStatus: () => request<AnalysisStatus>("/api/analysis/status"),

  askTutor: (body: {
    question: string;
    document_ids?: string[];
    concept_id?: string | null;
    history?: { role: "user" | "assistant"; content: string }[];
    allow_general_knowledge?: boolean;
  }) => request<TutorResponse>("/api/tutor/ask", { method: "POST", body, timeoutMs: LLM_TIMEOUT }),
  tutorHistory: () => request<{ turns: TutorHistoryTurn[] }>("/api/tutor/history"),

  generateMaterial: (
    kind: "notes" | "flashcards" | "practice-questions" | "simplified-explanation",
    body: Record<string, unknown>,
  ) =>
    request<MaterialItem>(`/api/materials/${kind}`, {
      method: "POST",
      body,
      timeoutMs: LLM_TIMEOUT,
    }),
  listMaterials: () => request<{ materials: MaterialItem[] }>("/api/materials"),
  getMaterial: (id: string) => request<MaterialItem>(`/api/materials/${id}`),
  deleteMaterial: (id: string) =>
    request<{ deleted: boolean }>(`/api/materials/${id}`, { method: "DELETE" }),

  createQuiz: (body: {
    num_questions?: number | undefined;
    concept_ids?: string[] | undefined;
    difficulty_mix?: Record<string, number> | undefined;
  }) =>
    request<{ id: string; question_count: number; created_at: string }>("/api/quizzes", {
      method: "POST",
      body,
      timeoutMs: LLM_TIMEOUT,
    }),
  listQuizzes: () => request<{ quizzes: QuizSummary[] }>("/api/quizzes"),
  getQuiz: (id: string) => request<PublicQuiz>(`/api/quizzes/${id}`),
  submitQuiz: (id: string, answers: Record<string, string | null>, timeTakenSeconds?: number) =>
    request<GradedAttempt>(`/api/quizzes/${id}/submit`, {
      method: "POST",
      body: { answers, time_taken_seconds: timeTakenSeconds ?? null },
    }),
  followUpQuiz: (body: {
    concept_ids?: string[] | undefined;
    num_questions?: number | undefined;
  }) =>
    request<{ id: string; question_count: number; created_at: string }>("/api/quizzes/followup", {
      method: "POST",
      body,
      timeoutMs: LLM_TIMEOUT,
    }),
  quizAttempts: (id: string) =>
    request<{ attempts: GradedAttempt[] }>(`/api/quizzes/${id}/attempts`),

  diagnose: (attemptId: string) =>
    request<BackendDiagnosis>("/api/diagnosis", {
      method: "POST",
      body: { attempt_id: attemptId },
      timeoutMs: LLM_TIMEOUT,
    }),
  latestDiagnosis: () => request<{ diagnosis: BackendDiagnosis | null }>("/api/diagnosis/latest"),

  getPath: () => request<PathBackend>("/api/path"),
  refreshPath: () => request<PathBackend>("/api/path/refresh", { method: "POST" }),
  completeStep: (conceptId: string) =>
    request<PathBackend>(`/api/path/steps/${encodeURIComponent(conceptId)}/complete`, {
      method: "POST",
    }),
  uncompleteStep: (conceptId: string) =>
    request<PathBackend>(`/api/path/steps/${encodeURIComponent(conceptId)}/uncomplete`, {
      method: "POST",
    }),

  progress: () => request<ProgressBackend>("/api/progress"),

  explain: (body: unknown) =>
    request<ExplainPayload>("/api/explain", { method: "POST", body, timeoutMs: LLM_TIMEOUT }),
};
