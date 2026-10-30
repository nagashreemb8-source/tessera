// Single place that decides whether Tessera talks to a backend or stays in demo mode.
// The browser only ever calls YOUR backend. It never calls NVIDIA or Nebius directly,
// and no API keys belong in frontend code.

export interface BackendConfig {
  configured: boolean;
  baseUrl: string;
}

export function getBackendConfig(): BackendConfig {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";
  const baseUrl = raw.replace(/\/+$/, "");
  return { configured: baseUrl.length > 0, baseUrl };
}
