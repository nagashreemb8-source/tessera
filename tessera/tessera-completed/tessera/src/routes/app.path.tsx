import { createFileRoute } from "@tanstack/react-router";
import { PathPage } from "@/pages/Path";

export const Route = createFileRoute("/app/path")({
  component: PathPage,
});
