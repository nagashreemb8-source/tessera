import { createFileRoute } from "@tanstack/react-router";
import { TutorPage } from "@/pages/Tutor";

export const Route = createFileRoute("/app/tutor")({
  component: TutorPage,
});
