import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  CornerDownLeft,
  Loader2,
  Send,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BackendNotice } from "@/components/BackendNotice";
import { PageHeader } from "@/components/ui/tessera";
import { api, ApiClientError } from "@/services/api";
import type { DefaultCitation, TutorTurnView } from "@/lib/tutorTypes";
import { useBackend } from "@/state/BackendContext";
import { useStudy } from "@/state/useStudy";
import { cn } from "@/lib/utils";

export function TutorPage() {
  const study = useStudy();
  const backend = useBackend();
  const [turns, setTurns] = useState<TutorTurnView[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowGeneral, setAllowGeneral] = useState(false);
  const [source, setSource] = useState<{
    citation: DefaultCitation;
    text: string | null;
    error: string | null;
  } | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (study.mode !== "backend") return;
    let live = true;
    setLoadingHistory(true);
    api
      .tutorHistory()
      .then((payload) => {
        if (!live) return;
        setTurns(
          payload.turns.map((turn) => ({
            role: turn.role,
            content: turn.content,
            citations: turn.citations,
          })),
        );
      })
      .catch(() => undefined)
      .finally(() => live && setLoadingHistory(false));
    return () => {
      live = false;
    };
  }, [study.mode]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, sending]);

  if (study.mode === "demo") {
    return (
      <BackendNotice
        title="Ask your documents"
        body="The tutor retrieves passages from your own PDFs and answers with page citations. Without a backend there are no documents to ground it in."
      />
    );
  }

  if (backend.documents.filter((doc) => doc.status !== "rejected").length === 0) {
    return (
      <>
        <PageHeader eyebrow="Tutor" title="Ask your documents" />
        <div className="panel p-8 text-center">
          <BookOpen className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-2xl">Upload a PDF first</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            The tutor only answers from your own material. It retrieves the most relevant passages
            before answering.
          </p>
          <Link to="/app/upload" className="btn btn-primary mt-5">
            Upload PDFs
          </Link>
        </div>
      </>
    );
  }

  const send = async () => {
    const text = question.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setQuestion("");
    setTurns((prev) => [...prev, { role: "user", content: text, citations: [] }]);
    try {
      const response = await api.askTutor({
        question: text,
        allow_general_knowledge: allowGeneral,
        history: turns.slice(-8).map((turn) => ({ role: turn.role, content: turn.content })),
      });
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: response.answer,
          citations: response.citations,
          notFound: response.not_found,
          supported: response.supported,
        },
      ]);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.code === "llm_not_configured"
            ? `${err.message} Chat needs the AI model; upload and retrieval still work without it.`
            : err.message
          : "The tutor could not answer. Please retry.";
      setError(message);
      setTurns((prev) => prev.slice(0, -1));
      setQuestion(text);
    } finally {
      setSending(false);
    }
  };

  const openSource = async (citation: DefaultCitation) => {
    setSource({ citation, text: null, error: null });
    try {
      const page = await api.getPage(citation.document_id, citation.page);
      setSource({ citation, text: page.text, error: null });
    } catch (err) {
      setSource({
        citation,
        text: null,
        error: err instanceof ApiClientError ? err.message : "Could not load that page.",
      });
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Tutor"
        title="Ask your documents"
        sub="Answers come only from passages retrieved from your PDFs, with page citations. If the documents don't cover it, the tutor says so."
        actions={
          <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allowGeneral}
              onChange={(event) => setAllowGeneral(event.target.checked)}
              className="accent-primary"
            />
            Allow a labelled general-knowledge hint
          </label>
        }
      />

      <div className={cn("grid gap-5", source && "lg:grid-cols-[minmax(0,1fr)_360px]")}>
        <section className="panel flex min-h-[460px] flex-col p-0" aria-label="Conversation">
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {loadingHistory && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading your
                conversation…
              </p>
            )}
            {!loadingHistory && turns.length === 0 && (
              <div className="py-10 text-center">
                <p className="font-display text-xl">Ask about anything in your study set.</p>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                  Try “Explain the difference between variance and standard deviation” or “What does
                  page 3 mean by …”.
                </p>
              </div>
            )}
            {turns.map((turn, index) => (
              <div
                key={`${turn.role}-${index}-${turn.content.slice(0, 12)}`}
                className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-4 py-3 text-sm",
                    turn.role === "user"
                      ? "bg-primary/15 text-foreground"
                      : turn.notFound
                        ? "border border-developing/40 bg-developing/10"
                        : "border border-border bg-surface-2",
                  )}
                >
                  {turn.role === "assistant" && (
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                      {turn.notFound ? (
                        <>
                          <TriangleAlert className="h-3 w-3 text-developing" aria-hidden="true" />{" "}
                          Not found in your documents
                        </>
                      ) : turn.supported ? (
                        <>
                          <ShieldCheck className="h-3 w-3 text-primary" aria-hidden="true" />{" "}
                          Grounded · {turn.citations.length} citation(s)
                        </>
                      ) : (
                        <>
                          <TriangleAlert className="h-3 w-3 text-developing" aria-hidden="true" />{" "}
                          Unverified answer
                        </>
                      )}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap leading-relaxed">{turn.content}</p>
                  {turn.citations.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {turn.citations.map((citation) => (
                        <button
                          key={`${citation.document_id}-${citation.page}`}
                          type="button"
                          className="btn btn-secondary h-8 min-h-8 px-2.5 text-[11px]"
                          onClick={() => void openSource(citation)}
                        >
                          {citation.document_name} · p.{citation.page}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Retrieving passages
                and writing an answer…
              </p>
            )}
            <div ref={endRef} />
          </div>

          {error && (
            <p
              role="alert"
              className="mx-5 mb-2 rounded-md border border-developing/40 bg-developing/10 px-3 py-2 text-xs text-developing"
            >
              {error}
            </p>
          )}

          <form
            className="border-t border-border p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="tutor-question" className="sr-only">
              Ask a question about your documents
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id="tutor-question"
                className="input min-h-12 flex-1 resize-none"
                rows={2}
                maxLength={2000}
                placeholder="Ask a question about your PDFs…"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <button
                type="submit"
                className="btn btn-primary h-12"
                disabled={sending || question.trim().length < 2}
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
                Ask
              </button>
            </div>
            <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" aria-hidden="true" /> Enter to send · Shift+Enter
              for a new line · answers are grounded, never invented
            </p>
          </form>
        </section>

        {source && (
          <aside className="panel p-5 lg:sticky lg:top-20 lg:self-start" aria-label="Source page">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="eyebrow">Source passage</p>
                <h2 className="mt-2 text-lg">{source.citation.document_name}</h2>
                <p className="text-xs text-muted-foreground">Page {source.citation.page}</p>
              </div>
              <button
                type="button"
                className="btn btn-quiet"
                aria-label="Close source viewer"
                onClick={() => setSource(null)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {source.citation.snippet && (
              <p className="mt-3 rounded-md border border-border bg-surface-2 p-3 text-xs italic text-muted-foreground">
                “{source.citation.snippet}”
              </p>
            )}
            <div className="mt-3 max-h-[52vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
              {source.text ??
                (source.error ? (
                  <span className="text-developing">{source.error}</span>
                ) : (
                  <span className="text-muted-foreground">Loading page…</span>
                ))}
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
