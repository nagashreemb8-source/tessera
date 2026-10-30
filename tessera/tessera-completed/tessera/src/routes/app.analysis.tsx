import { createFileRoute } from "@tanstack/react-router";
import { AnalysisPage } from "@/pages/Analysis";

export const Route = createFileRoute("/app/analysis")({
  component: AnalysisPage,
});
