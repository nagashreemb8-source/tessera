import { createFileRoute } from "@tanstack/react-router";
import { MapPage } from "@/pages/Map";

export const Route = createFileRoute("/app/map")({
  component: MapPage,
});
