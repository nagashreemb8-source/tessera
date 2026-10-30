/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Tessera Python backend, e.g. http://localhost:8000. Leave unset for demo mode. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
