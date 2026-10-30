import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

describe("App routing", () => {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
  it.each([
    "/",
    "/app",
    "/app/diagnose",
    "/app/results",
    "/app/replay",
    "/app/map",
    "/app/path",
    "/app/progress",
    "/app/concept/variance",
  ])("matches a page for %s", (p) => {
    expect(router.matchRoutes(p).at(-1)?.routeId).not.toBe(rootRouteId);
  });
});
