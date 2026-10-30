import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "@/pages/Overview";

export const Route = createFileRoute("/app/")({
  component: OverviewPage,
});
