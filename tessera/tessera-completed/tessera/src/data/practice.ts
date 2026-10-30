import { CONCEPT_CONTENT } from "@/data/conceptContent";
import { CONCEPT_IDS } from "@/data/concepts";
import type { ConceptId, OptionKey } from "@/types";

export interface PracticeQuestion {
  id: string;
  conceptId: ConceptId;
  prompt: string;
  options: Record<OptionKey, string>;
  correct: OptionKey;
  explanation: string;
  /** Short notes for specific wrong options, shown after an incorrect attempt. */
  wrongNotes: Partial<Record<OptionKey, string>>;
}

/** Second practice question per concept. The first comes from CONCEPT_CONTENT[...].check. */
const SECOND: Record<ConceptId, Omit<PracticeQuestion, "id" | "conceptId">> = {
  "basic-probability": {
    prompt: "P(A) = 0.6 and P(B) = 0.3, and A and B cannot happen together. What is P(A or B)?",
    options: { A: "0.18", B: "0.9", C: "0.6", D: "0.3" },
    correct: "B",
    explanation: "With no overlap there is nothing to subtract: 0.6 + 0.3 = 0.9.",
    wrongNotes: {
      A: "0.18 multiplies the probabilities. For 'or' you add, then subtract any overlap.",
    },
  },
  "random-variables": {
    prompt:
      "A coin is tossed 3 times. X is the number of tails. How many different values can X take?",
    options: { A: "2", B: "3", C: "4", D: "8" },
    correct: "C",
    explanation:
      "X can be 0, 1, 2 or 3 tails, so four values. The 8 outcomes (HHH, HHT, ...) map onto those four numbers.",
    wrongNotes: {
      D: "8 is the number of outcomes. X only takes the numbers 0 to 3.",
      B: "Zero tails is a possible value too, so counting 1 to 3 misses one.",
    },
  },
  "expected-value": {
    prompt: "X is 2 with probability 0.25 and 6 with probability 0.75. What is E[X]?",
    options: { A: "4", B: "5", C: "6", D: "3.5" },
    correct: "B",
    explanation:
      "2 × 0.25 + 6 × 0.75 = 0.5 + 4.5 = 5. The weights matter: 6 is three times as likely as 2.",
    wrongNotes: {
      A: "4 is the plain average of 2 and 6. Expected value weights each value by its probability.",
    },
  },
  variance: {
    prompt: "X is 0 or 6, each with probability 1/2. What is Var(X)?",
    options: { A: "3", B: "9", C: "18", D: "6" },
    correct: "B",
    explanation:
      "The mean is 3 and both values sit 3 away, so Var(X) = ½·9 + ½·9 = 9. The standard deviation is 3.",
    wrongNotes: {
      A: "3 is the standard deviation. Variance is its square.",
      C: "18 adds the squared deviations without weighting each by its probability.",
    },
  },
  "probability-distributions": {
    prompt: "X ~ Binomial(n = 4, p = 0.5). What is P(X = 2)?",
    options: { A: "0.25", B: "0.375", C: "0.5", D: "0.0625" },
    correct: "B",
    explanation: "C(4,2) = 6 arrangements, each 0.5⁴ = 0.0625, so 6 × 0.0625 = 0.375.",
    wrongNotes: {
      D: "0.0625 is the probability of one specific arrangement. Multiply by C(4,2) = 6.",
      A: "0.25 is P(X = 1) for this distribution, not P(X = 2).",
    },
  },
  "sampling-distributions": {
    prompt:
      "A population has σ = 20. For samples of size n = 16, what is the standard error of the sample mean?",
    options: { A: "20", B: "1.25", C: "5", D: "2.5" },
    correct: "C",
    explanation: "SE = σ / √n = 20 / 4 = 5.",
    wrongNotes: {
      A: "20 is the population standard deviation. Divide it by √n.",
      B: "1.25 divides by n (16) instead of √n (4).",
    },
  },
  "central-limit-theorem": {
    prompt:
      "A population has μ = 100 and σ = 20. For n = 25, the sample mean is roughly normal. What is its standard deviation?",
    options: { A: "20", B: "4", C: "0.8", D: "16" },
    correct: "B",
    explanation: "The standard deviation of X̄ is σ/√n = 20/5 = 4. Its mean stays at 100.",
    wrongNotes: {
      A: "20 is σ for individual values, not for the sample mean.",
      C: "0.8 divides by n (25) rather than √n (5).",
      D: "16 is the variance of X̄ (σ²/n). The question asks for the standard deviation.",
    },
  },
};

function build(id: ConceptId): PracticeQuestion[] {
  const c = CONCEPT_CONTENT[id]?.check;
  const second = SECOND[id];
  if (!c || !second) return [];
  return [
    {
      id: `${id}-1`,
      conceptId: id,
      prompt: c.prompt,
      options: c.options,
      correct: c.correct,
      explanation: c.explanation,
      wrongNotes: {},
    },
    { id: `${id}-2`, conceptId: id, ...second },
  ];
}

export const PRACTICE = Object.fromEntries(CONCEPT_IDS.map((id) => [id, build(id)])) as Record<
  ConceptId,
  PracticeQuestion[]
>;

/** Practice questions for a concept; empty when the concept is not part of the demo subject. */
export function getPractice(conceptId: ConceptId): PracticeQuestion[] {
  return PRACTICE[conceptId] ?? [];
}

export function practiceComplete(
  conceptId: ConceptId,
  answers: Record<string, OptionKey>,
): boolean {
  return getPractice(conceptId).every((q) => answers[q.id] === q.correct);
}
