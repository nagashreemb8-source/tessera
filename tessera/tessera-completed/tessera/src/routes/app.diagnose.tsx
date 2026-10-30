import { createFileRoute } from "@tanstack/react-router";
import { DiagnosePage } from "@/pages/Diagnose";

export const Route = createFileRoute("/app/diagnose")({
  validateSearch: (search: Record<string, unknown>): { concept?: string; followup?: boolean } => {
    const concept = search["concept"];
    return {
      ...(typeof concept === "string" && concept.length > 0 ? { concept } : {}),
      ...(search["followup"] === true || search["followup"] === "true" ? { followup: true } : {}),
    };
  },
  component: DiagnoseRoute,
});

function DiagnoseRoute() {
  const { concept, followup } = Route.useSearch();
  return <DiagnosePage concept={concept} followup={followup} />;
}
