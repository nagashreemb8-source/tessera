import { Link } from "@tanstack/react-router";
import { Database } from "lucide-react";
import type { ReactNode } from "react";
import { EVIDENCE_COPY } from "@/engine/diagnose";
import { getBackendConfig } from "@/services/apiConfig";
import { useBackend } from "@/state/BackendContext";
import { cn } from "@/lib/utils";
import type { EvidenceLevel, Status } from "@/types";

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <g stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2">
          <line x1="7" y1="7" x2="19" y2="7" />
          <line x1="7" y1="7" x2="7" y2="19" />
          <line x1="19" y1="7" x2="19" y2="19" />
        </g>
        <rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" fillOpacity="0.85" />
        <rect x="15" y="3" width="8" height="8" rx="2" fill="currentColor" fillOpacity="0.55" />
        <rect x="3" y="15" width="8" height="8" rx="2" fill="currentColor" fillOpacity="0.55" />
        <rect x="15" y="15" width="8" height="8" rx="2" className="fill-primary" />
      </svg>
      {!compact && (
        <span className="font-display text-xl leading-none tracking-tight">tessera</span>
      )}
    </span>
  );
}

export function DemoBadge() {
  const { configured } = getBackendConfig();
  const backend = useBackend();
  const unreachable = configured && backend.ready && !!backend.error;
  const label = !configured
    ? "Demo mode"
    : unreachable
      ? "AI mode · backend unreachable"
      : backend.ready
        ? "AI mode · your documents"
        : "AI mode · connecting…";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        unreachable
          ? "border-developing/50 bg-developing/10 text-developing"
          : "border-border-strong text-muted-foreground",
      )}
      title={
        configured
          ? "Connected to your local Tessera backend. Quizzes, diagnosis and materials are generated from the PDFs you upload."
          : "No backend URL is configured, so the app runs the offline sample subject with rule-based analysis. No AI model is called."
      }
    >
      <Database className="h-3 w-3" aria-hidden="true" /> {label}
    </span>
  );
}

const STATUS_LABEL: Record<Status, string> = {
  mastered: "Mastered",
  developing: "Developing",
  untested: "Not yet assessed",
};

export function statusLabel(s: Status) {
  return STATUS_LABEL[s];
}

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        status === "mastered" && "bg-primary/10 text-primary",
        status === "developing" && "bg-developing/10 text-developing",
        status === "untested" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "mastered" && "bg-primary",
          status === "developing" && "bg-developing",
          status === "untested" && "bg-muted-foreground",
        )}
        aria-hidden="true"
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function EvidenceMeter({
  level,
  showCopy = true,
}: {
  level: EvidenceLevel;
  showCopy?: boolean;
}) {
  const n = level === "Limited" ? 1 : level === "Some" ? 2 : 3;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="flex gap-0.5" aria-hidden="true">
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                "h-2 w-4 rounded-sm",
                i <= n ? "bg-violet" : "bg-surface-2 border border-border",
              )}
            />
          ))}
        </span>
        <span className="text-sm font-medium">{level} evidence</span>
      </div>
      {showCopy && <p className="mt-1 text-xs text-muted-foreground">{EVIDENCE_COPY[level]}</p>}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-3xl md:text-4xl">{title}</h1>
        {sub && <p className="mt-2 max-w-2xl text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel relative overflow-hidden px-6 py-14 text-center">
      <div className="mx-auto mb-5 w-fit text-muted-foreground">
        <Logo compact />
      </div>
      <h2 className="text-2xl">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {children ?? (
          <Link to="/app/diagnose" className="btn btn-primary">
            Start a diagnostic
          </Link>
        )}
      </div>
    </div>
  );
}

export function Bar({
  value,
  tone = "primary",
  label,
}: {
  value: number;
  tone?: "primary" | "developing" | "muted";
  label: string;
}) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
      role="img"
      aria-label={label}
    >
      <div
        className={cn(
          "animate-grow-x h-full rounded-full transition-[width] duration-700",
          tone === "primary" && "bg-primary",
          tone === "developing" && "bg-developing",
          tone === "muted" && "bg-muted-foreground/50",
        )}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}
