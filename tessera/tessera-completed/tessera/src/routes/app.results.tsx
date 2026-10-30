import { createFileRoute } from "@tanstack/react-router";
import { ResultsPage } from "@/pages/Results";

export const Route = createFileRoute("/app/results")({
  component: ResultsPage,
});
