import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  FileText,
  Loader2,
  Microscope,
  Paperclip,
  Trash2,
  TriangleAlert,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";
import { BackendNotice } from "@/components/BackendNotice";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Bar, PageHeader } from "@/components/ui/tessera";
import { ApiClientError } from "@/services/api";
import type { DocumentOut, UploadFileResult } from "@/services/apiTypes";
import { useBackend } from "@/state/BackendContext";
import { useStudy } from "@/state/useStudy";
import { cn } from "@/lib/utils";

function statusStyle(status: string) {
  if (status === "processed") return "border-primary/50 bg-primary/10 text-primary";
  if (status === "partial") return "border-developing/50 bg-developing/10 text-developing";
  return "border-border bg-surface-2 text-muted-foreground";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "processed")
    return <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />;
  if (status === "partial")
    return <TriangleAlert className="h-4 w-4 text-developing" aria-hidden="true" />;
  return <XCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
}

export function UploadPage() {
  const study = useStudy();
  const backend = useBackend();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [results, setResults] = useState<UploadFileResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocumentOut | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (study.mode === "demo") {
    return (
      <BackendNotice
        title="Upload your own PDFs"
        body="Uploading, document analysis, the tutor, study materials and generated quizzes all run in the local FastAPI backend. Point the frontend at it to study your own material."
      />
    );
  }

  const pdfFiles = (files: FileList | File[] | null) =>
    Array.from(files ?? []).filter((file) => file.name.toLowerCase().endsWith(".pdf"));

  const upload = async (files: File[]) => {
    const selected = pdfFiles(files);
    if (selected.length === 0) {
      setError("Choose one or more PDF files.");
      return;
    }
    setUploading(true);
    setError(null);
    setProgress(0);
    setResults([]);
    try {
      const response = await backend.uploadFiles(selected, setProgress);
      setResults(response.results);
      await backend.refreshAnalysis();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "The upload failed.");
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await backend.deleteDocument(pendingDelete.id);
      setResults([]);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not delete that document.");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const readable = backend.documents.filter((doc) => doc.status !== "rejected");
  const rejected = backend.documents.filter((doc) => doc.status === "rejected");
  const analysisReady = backend.analysis?.status === "ready";

  return (
    <>
      <PageHeader
        eyebrow="Study set"
        title="Your documents"
        sub="Upload lecture notes, textbook chapters or papers. Every quiz, tutor answer and diagnosis is generated from these files only."
        actions={
          <Link to="/app/analysis" className="btn btn-secondary">
            <Microscope className="h-4 w-4" aria-hidden="true" /> Analysis
          </Link>
        }
      />

      <section className="panel p-6" aria-labelledby="upload">
        <h2 id="upload" className="text-xl">
          Add PDFs
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload several PDFs at a time. Text is extracted per page, so text-based PDFs work best;
          scanned pages need OCR first.
        </p>
        <div
          className={cn(
            "mt-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border bg-surface-2/40",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void upload(Array.from(event.dataTransfer.files));
          }}
        >
          <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm">Drag PDFs here, or choose files</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="sr-only"
            id="pdf-input"
            onChange={(event) => void upload(Array.from(event.target.files ?? []))}
          />
          <button
            type="button"
            className="btn btn-primary mt-4"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Paperclip className="h-4 w-4" aria-hidden="true" />
            )}
            {uploading ? "Uploading…" : "Choose PDF files"}
          </button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            PDF only · text-based documents work best
          </p>
        </div>

        {progress !== null && (
          <div className="mt-4">
            <Bar value={progress / 100} label={`Upload ${progress}%`} />
            <p className="mt-1 text-xs text-muted-foreground">Uploading {progress}%…</p>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-developing/40 bg-developing/10 px-4 py-2 text-sm text-developing"
          >
            {error}
          </p>
        )}

        {results.length > 0 && (
          <ul className="mt-5 space-y-2" aria-label="Upload results">
            {results.map((result) => (
              <li
                key={`${result.filename}-${result.document_id}-${result.error_code}`}
                className="panel-raised p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusIcon status={result.status} />
                  <span className="text-sm font-medium">{result.filename}</span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide",
                      statusStyle(result.status),
                    )}
                  >
                    {result.status}
                  </span>
                  {result.error_code && (
                    <code className="text-[11px] text-muted-foreground">{result.error_code}</code>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{result.message}</p>
                {result.page_count > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {result.page_count} page(s) · {result.chunk_count} passage(s)
                  </p>
                )}
                {result.warnings.map((warning) => (
                  <p key={warning} className="mt-1 text-xs text-developing">
                    {warning}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel mt-5 p-6" aria-labelledby="docs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="docs" className="text-xl">
              In this study set
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {readable.length} readable document(s)
            </p>
          </div>
          {readable.length > 0 && (
            <Link to="/app/analysis" className="btn btn-primary">
              <Microscope className="h-4 w-4" aria-hidden="true" />
              {analysisReady ? "View analysis" : "Analyse documents"}
            </Link>
          )}
        </div>

        {backend.documents.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nothing uploaded yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {[...readable, ...rejected].map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 py-3">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.status === "rejected"
                      ? `Not usable · ${doc.error_code ?? "rejected"}`
                      : `${doc.page_count} page(s) · ${doc.chunk_count} passage(s) · ${(doc.size_bytes / 1024 / 1024).toFixed(1)} MB`}
                  </p>
                  {doc.warnings.map((warning) => (
                    <p key={warning} className="mt-1 text-xs text-developing">
                      {warning}
                    </p>
                  ))}
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] uppercase",
                    statusStyle(doc.status),
                  )}
                >
                  {doc.status}
                </span>
                <button
                  type="button"
                  className="btn btn-quiet"
                  aria-label={`Delete ${doc.filename}`}
                  onClick={() => setPendingDelete(doc)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="border-border bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl font-medium">
              Delete this document?
            </AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.filename}” and its extracted text are removed. Analyses, quizzes,
              attempts, diagnoses and learning paths built from it are invalidated, because they
              would no longer be grounded in your material.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="btn btn-secondary">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="btn btn-primary"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete and invalidate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
