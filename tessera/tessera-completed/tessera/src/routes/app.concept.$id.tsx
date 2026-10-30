import { createFileRoute } from "@tanstack/react-router";
import { ConceptPage } from "@/pages/Concept";

export const Route = createFileRoute("/app/concept/$id")({
  component: ConceptRoute,
});

function ConceptRoute() {
  const { id } = Route.useParams();
  return <ConceptPage key={id} id={id} />;
}
