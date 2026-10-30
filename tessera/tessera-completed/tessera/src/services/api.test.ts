import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BASE = "http://localhost:8000";
const SESSION_KEY = "tessera.backend.session.v1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Fresh module per test: the client memoises the session id at module scope. */
async function loadClient() {
  vi.resetModules();
  return import("@/services/api");
}

beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", BASE);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("api client", () => {
  it("creates one session, stores it and sends it as X-Session-Id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ session_id: "session-123" }))
      .mockResolvedValueOnce(json([]));

    const api = await loadClient();
    vi.stubGlobal("fetch", fetchMock);
    await api.api.listDocuments();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}/api/sessions`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/documents`);
    expect((init.headers as Record<string, string>)["X-Session-Id"]).toBe("session-123");
    expect(window.localStorage.getItem(SESSION_KEY)).toBe("session-123");
  });

  it("reuses a session id already in localStorage instead of creating a new one", async () => {
    window.localStorage.setItem(SESSION_KEY, "stored-session");
    const fetchMock = vi.fn().mockResolvedValueOnce(json([]));

    const api = await loadClient();
    vi.stubGlobal("fetch", fetchMock);
    await api.api.listDocuments();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/documents`);
    expect((init.headers as Record<string, string>)["X-Session-Id"]).toBe("stored-session");
  });

  it("omits the session header for endpoints that do not need one", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ status: "ok" }));

    const api = await loadClient();
    vi.stubGlobal("fetch", fetchMock);
    await api.api.health();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Session-Id"]).toBeUndefined();
  });

  it("surfaces the backend error envelope as a typed error", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      json(
        {
          error: {
            code: "document_not_found",
            message: "That document does not exist in this session.",
            details: { id: "abc" },
          },
        },
        404,
      ),
    );

    const api = await loadClient();
    vi.stubGlobal("fetch", fetchMock);

    const error = await api.api.getDocument("abc").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(api.ApiClientError);
    const typed = error as InstanceType<typeof api.ApiClientError>;
    expect(typed.code).toBe("document_not_found");
    expect(typed.status).toBe(404);
    expect(typed.message).toBe("That document does not exist in this session.");
    expect(typed.details).toEqual({ id: "abc" });
  });

  it("falls back to a generic code when the error body is not the envelope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));

    const api = await loadClient();
    vi.stubGlobal("fetch", fetchMock);

    const error = (await api.api.getDocument("abc").catch((e: unknown) => e)) as InstanceType<
      typeof api.ApiClientError
    >;
    expect(error.code).toBe("http_502");
    expect(error.message).toContain("502");
  });

  it("refuses to call the network when no backend is configured", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    const fetchMock = vi.fn();

    const api = await loadClient();
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.api.listDocuments()).rejects.toMatchObject({
      code: "backend_not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a clear network error when the backend is unreachable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const api = await loadClient();
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem(SESSION_KEY, "stored-session");

    await expect(api.api.listDocuments()).rejects.toMatchObject({ code: "network_error" });
  });
});
