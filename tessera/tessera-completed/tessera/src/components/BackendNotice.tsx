import { Link } from "@tanstack/react-router";
import { ServerCog } from "lucide-react";
import { PageHeader } from "@/components/ui/tessera";

/**
 * Shown on AI-only screens when VITE_API_BASE_URL is empty.
 * Demo mode never pretends a backend exists.
 */
export function BackendNotice({ title, body }: { title: string; body: string }) {
  return (
    <>
      <PageHeader eyebrow="AI mode" title={title} />
      <div className="panel p-7">
        <ServerCog className="h-6 w-6 text-primary" aria-hidden="true" />
        <h2 className="mt-4 text-2xl">This screen needs the Tessera backend</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{body}</p>
        <div className="mt-5 space-y-2 rounded-md border border-border bg-surface-2 p-4 font-mono text-xs">
          <p># backend (from the project root)</p>
          <p>cd backend</p>
          <p>py -m venv .venv</p>
          <p>.\.venv\Scripts\Activate.ps1</p>
          <p>pip install -r requirements.txt</p>
          <p>copy .env.example .env &nbsp;# add your Nebius values</p>
          <p>uvicorn app.main:app --reload --port 8000</p>
          <p className="pt-2"># frontend: set VITE_API_BASE_URL=http://localhost:8000 in .env</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link to="/app/diagnose" className="btn btn-primary">
            Use the offline demo instead
          </Link>
          <Link to="/app" className="btn btn-secondary">
            Back to overview
          </Link>
        </div>
      </div>
    </>
  );
}
