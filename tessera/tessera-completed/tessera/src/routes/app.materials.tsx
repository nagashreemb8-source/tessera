import { createFileRoute } from "@tanstack/react-router";
import { MaterialsPage } from "@/pages/Materials";

export const Route = createFileRoute("/app/materials")({
  component: MaterialsPage,
});
