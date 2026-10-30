import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  ApiClientError,
  ensureSession,
  isBackendMode,
  getStoredSessionId,
} from "@/services/api";
import { conceptsFromGraph } from "@/services/adapters";
import type {
  AnalysisResponse,
  BackendDiagnosis,
  DocumentOut,
  MaterialItem,
  PathBackend,
  ProgressBackend,
  QuizSummary,
  UploadResponse,
} from "@/services/apiTypes";
import type { Concept } from "@/types";

export interface BackendValue {
  configured: boolean;
  ready: boolean;
  loading: boolean;
  error: string | null;
  sessionId: string | null;
  documents: DocumentOut[];
  analysis: AnalysisResponse | null;
  analysisRunning: boolean;
  materials: MaterialItem[];
  quizzes: QuizSummary[];
  progress: ProgressBackend | null;
  diagnosis: BackendDiagnosis | null;
  path: PathBackend | null;
  concepts: Concept[];
  refresh: () => Promise<void>;
  refreshDocuments: () => Promise<void>;
  refreshAnalysis: () => Promise<void>;
  refreshMaterials: () => Promise<void>;
  refreshProgress: () => Promise<void>;
  refreshDiagnosis: () => Promise<void>;
  refreshPath: () => Promise<void>;
  refreshQuizzes: () => Promise<void>;
  uploadFiles: (files: File[], onProgress?: (percent: number) => void) => Promise<UploadResponse>;
  deleteDocument: (id: string) => Promise<void>;
  runAnalysis: () => Promise<void>;
  startNewSession: () => Promise<void>;
  deleteMyData: () => Promise<void>;
  completeStep: (conceptId: string, completed: boolean) => Promise<void>;
  setDiagnosis: (diagnosis: BackendDiagnosis) => void;
}

const BackendContext = createContext<BackendValue | null>(null);

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "Something went wrong talking to the backend.";
}

const emptyPath: PathBackend = {
  id: null,
  created_at: null,
  steps: [],
  concepts: [],
  completed_count: 0,
};

export function BackendProvider({ children }: { children: ReactNode }) {
  const configured = isBackendMode();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentOut[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [progress, setProgress] = useState<ProgressBackend | null>(null);
  const [diagnosis, setDiagnosis] = useState<BackendDiagnosis | null>(null);
  const [path, setPath] = useState<PathBackend>(emptyPath);
  const mounted = useRef(true);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const refreshDocuments = useCallback(async () => {
    if (!configured) return;
    try {
      setDocuments(await api.listDocuments());
    } catch (err) {
      setError(messageFor(err));
    }
  }, [configured]);

  const refreshAnalysis = useCallback(async () => {
    if (!configured) return;
    try {
      const payload = await api.getAnalysis();
      if (mounted.current) setAnalysis(payload);
    } catch (err) {
      setError(messageFor(err));
    }
  }, [configured]);

  const refreshMaterials = useCallback(async () => {
    if (!configured) return;
    try {
      const payload = await api.listMaterials();
      if (mounted.current) setMaterials(payload.materials);
    } catch {
      /* materials are optional */
    }
  }, [configured]);

  const refreshQuizzes = useCallback(async () => {
    if (!configured) return;
    try {
      const payload = await api.listQuizzes();
      if (mounted.current) setQuizzes(payload.quizzes);
    } catch {
      /* ignore */
    }
  }, [configured]);

  const refreshProgress = useCallback(async () => {
    if (!configured) return;
    try {
      const payload = await api.progress();
      if (mounted.current) setProgress(payload);
    } catch {
      /* progress needs analysis; ignore transient errors */
    }
  }, [configured]);

  const refreshDiagnosis = useCallback(async () => {
    if (!configured) return;
    try {
      const payload = await api.latestDiagnosis();
      if (mounted.current) setDiagnosis(payload.diagnosis);
    } catch {
      /* no diagnosis yet */
    }
  }, [configured]);

  const refreshPath = useCallback(async () => {
    if (!configured) return;
    try {
      const payload = await api.getPath();
      if (mounted.current) setPath(payload);
    } catch {
      /* path is optional before analysis */
    }
  }, [configured]);

  const refresh = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    try {
      const id = await ensureSession();
      if (mounted.current) {
        setSessionId(id);
        setError(null);
      }
      await Promise.all([
        refreshDocuments(),
        refreshAnalysis(),
        refreshMaterials(),
        refreshQuizzes(),
        refreshProgress(),
        refreshDiagnosis(),
        refreshPath(),
      ]);
    } catch (err) {
      if (mounted.current) setError(messageFor(err));
    } finally {
      if (mounted.current) {
        setLoading(false);
        setReady(true);
      }
    }
  }, [
    configured,
    refreshAnalysis,
    refreshDiagnosis,
    refreshDocuments,
    refreshMaterials,
    refreshPath,
    refreshProgress,
    refreshQuizzes,
  ]);

  useEffect(() => {
    if (!configured) {
      setReady(true);
      setLoading(false);
      return;
    }
    void refresh();
  }, [configured, refresh]);

  const pollAnalysis = useCallback(async () => {
    if (!configured) return;
    const tick = async () => {
      try {
        const status = await api.getAnalysisStatus();
        if (!mounted.current) return;
        if (status.status === "ready" || status.status === "failed") {
          await refreshAnalysis();
          await Promise.all([refreshPath(), refreshProgress()]);
          return;
        }
        setAnalysis((prev) =>
          prev
            ? { ...prev, status: status.status, progress: status.progress, stage: status.stage }
            : prev,
        );
        pollTimer.current = setTimeout(tick, 1500);
      } catch {
        pollTimer.current = setTimeout(tick, 3000);
      }
    };
    await tick();
  }, [configured, refreshAnalysis, refreshPath, refreshProgress]);

  const runAnalysis = useCallback(async () => {
    if (!configured) return;
    setError(null);
    try {
      const started = await api.startAnalysis();
      if (mounted.current) setAnalysis(started);
      await pollAnalysis();
    } catch (err) {
      setError(messageFor(err));
    }
  }, [configured, pollAnalysis]);

  const uploadFiles = useCallback(
    async (files: File[], onProgress?: (percent: number) => void) => {
      const result = await (await import("@/services/api")).uploadDocuments(files, onProgress);
      if (mounted.current) {
        setDocuments(result.documents);
        setError(null);
      }
      await refreshProgress();
      return result;
    },
    [refreshProgress],
  );

  const deleteDocument = useCallback(
    async (id: string) => {
      await api.deleteDocument(id);
      await refresh();
    },
    [refresh],
  );

  const startNewSession = useCallback(async () => {
    setLoading(true);
    try {
      await ensureSession(true);
      setDiagnosis(null);
      setPath(emptyPath);
      await refresh();
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [refresh]);

  const deleteMyData = useCallback(async () => {
    await api.deleteMyData();
    if (mounted.current) {
      setDocuments([]);
      setAnalysis(null);
      setMaterials([]);
      setQuizzes([]);
      setProgress(null);
      setDiagnosis(null);
      setPath(emptyPath);
    }
    await startNewSession();
  }, [startNewSession]);

  const completeStep = useCallback(
    async (conceptId: string, completed: boolean) => {
      const next = completed
        ? await api.completeStep(conceptId)
        : await api.uncompleteStep(conceptId);
      if (mounted.current) setPath(next);
      await refreshProgress();
    },
    [refreshProgress],
  );

  const concepts = useMemo(() => {
    if (!configured) return [];
    const graph = analysis?.result;
    if (graph && graph.concepts.length > 0) {
      return conceptsFromGraph(graph.concepts, graph.edges);
    }
    if (diagnosis && diagnosis.concepts.length > 0) {
      return conceptsFromGraph(diagnosis.concepts, []);
    }
    if (path.concepts.length > 0) {
      return conceptsFromGraph(path.concepts, []);
    }
    return [];
  }, [configured, analysis, diagnosis, path.concepts]);

  const value = useMemo<BackendValue>(
    () => ({
      configured,
      ready,
      loading,
      error,
      sessionId: sessionId ?? getStoredSessionId(),
      documents,
      analysis,
      analysisRunning: analysis?.status === "running",
      materials,
      quizzes,
      progress,
      diagnosis,
      path,
      concepts,
      refresh,
      refreshDocuments,
      refreshAnalysis,
      refreshMaterials,
      refreshProgress,
      refreshDiagnosis,
      refreshPath,
      refreshQuizzes,
      uploadFiles,
      deleteDocument,
      runAnalysis,
      startNewSession,
      deleteMyData,
      completeStep,
      setDiagnosis,
    }),
    [
      configured,
      ready,
      loading,
      error,
      sessionId,
      documents,
      analysis,
      materials,
      quizzes,
      progress,
      diagnosis,
      path,
      concepts,
      refresh,
      refreshDocuments,
      refreshAnalysis,
      refreshMaterials,
      refreshProgress,
      refreshDiagnosis,
      refreshPath,
      refreshQuizzes,
      uploadFiles,
      deleteDocument,
      runAnalysis,
      startNewSession,
      deleteMyData,
      completeStep,
    ],
  );

  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;
}

export function useBackend(): BackendValue {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error("useBackend must be used inside BackendProvider");
  return ctx;
}
