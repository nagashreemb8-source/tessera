import { createFileRoute } from "@tanstack/react-router";
import { ReplayPage } from "@/pages/Replay";

export const Route = createFileRoute("/app/replay")({
  validateSearch: (search: Record<string, unknown>): { concept?: string } => {
    const c = search["concept"];
    return typeof c === "string" && c.length > 0 ? { concept: c } : {};
  },
  component: ReplayRoute,
});

function ReplayRoute() {
  const { concept } = Route.useSearch();
  return <ReplayPage concept={concept} />;
}
