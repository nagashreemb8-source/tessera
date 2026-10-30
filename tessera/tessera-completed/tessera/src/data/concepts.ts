import type { Concept, ConceptId } from "@/types";

export const CONCEPTS: Concept[] = [
  {
    id: "basic-probability",
    name: "Basic Probability",
    description: "How likely events are, and how to combine them with rules like 'or' and 'and'.",
    prerequisites: [],
    minutes: 15,
  },
  {
    id: "random-variables",
    name: "Random Variables",
    description: "A rule that turns each random outcome into a number you can calculate with.",
    prerequisites: ["basic-probability"],
    minutes: 15,
  },
  {
    id: "expected-value",
    name: "Expected Value",
    description:
      "The long-run average of a random variable, weighting each value by its probability.",
    prerequisites: ["random-variables"],
    minutes: 20,
  },
  {
    id: "variance",
    name: "Variance",
    description:
      "How spread out a random variable is: the expected squared distance from its mean.",
    prerequisites: ["expected-value"],
    minutes: 25,
  },
  {
    id: "probability-distributions",
    name: "Probability Distributions",
    description:
      "Named families, like the binomial, that describe the probability of every possible value.",
    prerequisites: ["random-variables"],
    minutes: 25,
  },
  {
    id: "sampling-distributions",
    name: "Sampling Distributions",
    description:
      "How a statistic such as the sample mean varies from one random sample to the next.",
    prerequisites: ["probability-distributions", "expected-value"],
    minutes: 30,
  },
  {
    id: "central-limit-theorem",
    name: "Central Limit Theorem",
    description:
      "Why averages of many independent values tend toward a normal shape, whatever the source.",
    prerequisites: ["sampling-distributions", "variance"],
    minutes: 30,
  },
];

export const CONCEPT_BY_ID = Object.fromEntries(CONCEPTS.map((c) => [c.id, c])) as Record<
  ConceptId,
  Concept
>;

export const CONCEPT_IDS = CONCEPTS.map((c) => c.id);

/** Safe lookup: demo ids are known, but backend-derived ids are not in this table. */
export function getConcept(id: ConceptId): Concept | undefined {
  return CONCEPT_BY_ID[id];
}

export function conceptName(id: ConceptId) {
  return CONCEPT_BY_ID[id]?.name ?? id;
}

export function isConceptId(id: string): id is ConceptId {
  return id in CONCEPT_BY_ID;
}

export function dependentsOf(id: ConceptId): ConceptId[] {
  return CONCEPTS.filter((c) => c.prerequisites.includes(id)).map((c) => c.id);
}

export function depthOf(id: ConceptId): number {
  const c = CONCEPT_BY_ID[id];
  if (!c || c.prerequisites.length === 0) return 0;
  return 1 + Math.max(...c.prerequisites.map(depthOf));
}

/** Fixed layered positions for the knowledge map (viewBox 1000 x 420). */
export const MAP_LAYOUT: Record<ConceptId, { x: number; y: number }> = {
  "basic-probability": { x: 95, y: 210 },
  "random-variables": { x: 297, y: 210 },
  "expected-value": { x: 499, y: 115 },
  "probability-distributions": { x: 499, y: 305 },
  variance: { x: 701, y: 115 },
  "sampling-distributions": { x: 701, y: 305 },
  "central-limit-theorem": { x: 903, y: 210 },
};
