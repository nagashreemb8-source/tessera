import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  ChevronRight,
  Compass,
  FileText,
  LayoutDashboard,
  LineChart,
  MessagesSquare,
  Microscope,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Route as RouteIcon,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DemoBadge, Logo } from "@/components/ui/tessera";
import { getConcept } from "@/data/concepts";
import { SAMPLE_STUDENT } from "@/data/sampleStudent";
import { cn } from "@/lib/utils";
import { useTessera } from "@/state/AppState";
import { useBackend } from "@/state/BackendContext";
import { useStudy } from "@/state/useStudy";

const DEMO_NAV = [
  { to: "/app", label: "Overview", icon: LayoutDashboard },
  { to: "/app/diagnose", label: "Diagnose", icon: Compass },
  { to: "/app/map", label: "Knowledge Map", icon: Network },
  { to: "/app/path", label: "Learning Path", icon: RouteIcon },
  { to: "/app/progress", label: "Progress", icon: LineChart },
] as const;

const AI_NAV = [
  { to: "/app", label: "Overview", icon: LayoutDashboard },
  { to: "/app/upload", label: "Documents", icon: FileText },
  { to: "/app/analysis", label: "Analysis", icon: Microscope },
  { to: "/app/diagnose", label: "Diagnose", icon: Compass },
  { to: "/app/map", label: "Knowledge Map", icon: Network },
  { to: "/app/path", label: "Learning Path", icon: RouteIcon },
  { to: "/app/tutor", label: "Tutor", icon: MessagesSquare },
  { to: "/app/materials", label: "Study Materials", icon: BookOpen },
  { to: "/app/progress", label: "Progress", icon: LineChart },
] as const;

const CRUMBS: Record<string, string> = {
  "/app": "Overview",
  "/app/upload": "Documents",
  "/app/analysis": "Analysis",
  "/app/diagnose": "Diagnose",
  "/app/results": "Results",
  "/app/replay": "Root Cause Replay",
  "/app/map": "Knowledge Map",
  "/app/path": "Learning Path",
  "/app/tutor": "Tutor",
  "/app/materials": "Study Materials",
  "/app/progress": "Progress",
};

function SettingsPanel({ collapsed }: { collapsed: boolean }) {
  const { state, dispatch } = useTessera();
  const backend = useBackend();
  const navigate = useNavigate();
  const demoMode = !backend.configured;

  return (
    <Popover>
      <PopoverTrigger
        className={cn("btn btn-quiet w-full justify-start", collapsed && "justify-center px-0")}
        aria-label="Settings"
      >
        <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!collapsed && "Settings"}
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-80 border-border bg-surface-2">
        {demoMode ? (
          <>
            <p className="text-sm font-medium">Demo settings</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No backend URL is configured, so the app is running the offline sample subject.
              Progress is saved in this browser only.
            </p>
            <button
              type="button"
              className="btn btn-secondary mt-4 w-full"
              onClick={() => {
                dispatch({ type: "reset" });
                toast.success("Demo reset", {
                  description: "Answers, diagnosis and progress were cleared.",
                });
                navigate({ to: "/app" });
              }}
            >
              Reset demo
            </button>
            <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={state.simulateFailure}
                onChange={(event) =>
                  dispatch({ type: "simulateFailure", value: event.target.checked })
                }
                className="accent-primary"
              />
              Simulate a loading failure on Overview
            </label>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">AI study session</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your documents, quizzes and diagnoses are tied to an anonymous session id stored in
              this browser. No login, no keys in the browser.
            </p>
            <p className="mt-2 truncate rounded border border-border bg-surface px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {backend.sessionId ?? "connecting…"}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                className="btn btn-secondary w-full"
                onClick={async () => {
                  await backend.startNewSession();
                  toast.success("New session started", {
                    description:
                      "Your previous session's data stays on the server but is no longer shown.",
                  });
                  navigate({ to: "/app/upload" });
                }}
              >
                Start a new session
              </button>
              <button
                type="button"
                className="btn btn-quiet w-full text-developing"
                onClick={async () => {
                  await backend.deleteMyData();
                  toast.success("Your data was deleted", {
                    description:
                      "Documents, analyses, quizzes, diagnoses and files for this session were removed.",
                  });
                  navigate({ to: "/app" });
                }}
              >
                Delete my session data
              </button>
              <Link to="/app/upload" className="btn btn-quiet w-full">
                Manage documents
              </Link>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const { hydrated } = useTessera();
  const study = useStudy();
  const backend = useBackend();
  const pathname =
    useRouterState({ select: (state) => state.location.pathname }).replace(/\/$/, "") || "/app";
  const isActive = (to: string) => (to === "/app" ? pathname === "/app" : pathname.startsWith(to));
  const nav = study.mode === "backend" ? AI_NAV : DEMO_NAV;
  const mobileNav =
    study.mode === "backend"
      ? ([AI_NAV[0], AI_NAV[1], AI_NAV[3], AI_NAV[6], AI_NAV[8]] as const)
      : DEMO_NAV;

  let crumb: string | undefined = CRUMBS[pathname];
  if (!crumb && pathname.startsWith("/app/concept/")) {
    const id = pathname.split("/").pop() ?? "";
    crumb = study.conceptName(id) || getConcept(id)?.name || "Concept";
  }

  return (
    <div className="flex min-h-screen w-full">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center border-b border-border px-4",
            collapsed && "justify-center px-0",
          )}
        >
          <Link to="/" aria-label="Tessera home" className="rounded">
            <Logo compact={collapsed} />
          </Link>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="Main">
          {nav.map((item) => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                  collapsed && "justify-center px-0",
                  active
                    ? "bg-surface-2 text-foreground"
                    : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
                )}
              >
                {active && (
                  <span
                    className="absolute bottom-2 left-0 top-2 w-0.5 rounded bg-primary"
                    aria-hidden="true"
                  />
                )}
                <item.icon
                  className={cn("h-4 w-4 shrink-0", active && "text-primary")}
                  aria-hidden="true"
                />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-border p-2">
          <SettingsPanel collapsed={collapsed} />
          <div
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2",
              collapsed && "justify-center px-0",
            )}
          >
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold"
              aria-hidden="true"
            >
              {study.mode === "backend" ? "AI" : "MR"}
            </span>
            {!collapsed && (
              <span className="min-w-0 text-xs leading-tight">
                <span className="block truncate font-medium">
                  {study.mode === "backend" ? "Your study set" : SAMPLE_STUDENT.name}
                </span>
                <span className="text-muted-foreground">
                  {study.mode === "backend"
                    ? `${backend.documents.filter((doc) => doc.status !== "rejected").length} document(s)`
                    : "demo student"}
                </span>
              </span>
            )}
          </div>
          <button
            type="button"
            className={cn("btn btn-quiet w-full justify-start", collapsed && "justify-center px-0")}
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/90 px-4 backdrop-blur md:px-8">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
            <Link to="/" className="md:hidden" aria-label="Tessera home">
              <Logo compact />
            </Link>
            <Link
              to={study.mode === "backend" ? "/app/upload" : "/app"}
              className="hidden text-muted-foreground hover:text-foreground md:inline"
            >
              {study.mode === "backend" ? "Your documents" : "Probability & Statistics"}
            </Link>
            <ChevronRight
              className="hidden h-3.5 w-3.5 text-muted-foreground md:block"
              aria-hidden="true"
            />
            <span className="truncate font-medium" aria-current="page">
              {crumb ?? "Overview"}
            </span>
          </nav>
          <DemoBadge />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 pb-28 md:px-8 md:pb-12">
          {hydrated ? (
            <Outlet />
          ) : (
            <div role="status" aria-label="Loading your progress" className="space-y-4">
              <div className="h-9 w-2/3 animate-pulse rounded bg-surface-2" />
              <div className="h-40 animate-pulse rounded-lg bg-surface" />
            </div>
          )}
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-surface/95 backdrop-blur md:hidden"
        style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0, 1fr))` }}
      >
        {mobileNav.map((item) => {
          const active = isActive(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px]",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="h-5 w-5" aria-hidden="true" />
              {item.label.replace("Knowledge ", "").replace("Learning ", "").replace("Study ", "")}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
