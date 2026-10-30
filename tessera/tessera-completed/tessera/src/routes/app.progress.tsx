import { createFileRoute } from "@tanstack/react-router";
import { ProgressPage } from "@/pages/Progress";

export const Route = createFileRoute("/app/progress")({
  component: ProgressPage,
});
