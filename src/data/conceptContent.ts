import type { ConceptId, OptionKey } from "@/types";

export interface ConceptContent {
  explanation: string[];
  formula: string;
  example: { prompt: string; steps: string[]; answer: string };
  /** Small bar illustration: label + height (0..1). */
  bars: { label: string; value: number; caption?: string }[];
  barsCaption: string;
  check: {
    prompt: string;
    options: Record<OptionKey, string>;
    correct: OptionKey;
    explanation: string;
  };
}

/** Safe lookup: hand-written lessons exist only for the demo subject. */
export function getConceptContent(id: ConceptId): ConceptContent | undefined {
  return CONCEPT_CONTENT[id];
}

export const CONCEPT_CONTENT: Record<ConceptId, ConceptContent> = {
  "basic-probability": {
    explanation: [
      "Probability measures how likely an event is, from 0 (impossible) to 1 (certain). With equally likely outcomes, it is the number of favourable outcomes divided by the total.",
      "To find the chance of A or B, add their probabilities, then subtract the overlap so outcomes in both are not counted twice.",
    ],
    formula: "P(A ∪ B) = P(A) + P(B) − P(A ∩ B)",
    example: {
      prompt: "Roll a fair die. What is P(even or greater than 4)?",
      steps: [
        "Even = {2, 4, 6}, so P = 3/6.",
        "Greater than 4 = {5, 6}, so P = 2/6.",
        "Both = {6}, so P = 1/6.",
        "3/6 + 2/6 − 1/6 = 4/6.",
      ],
      answer: "2/3",
    },
    bars: [1, 2, 3, 4, 5, 6].map((n) => ({
      label: String(n),
      value: 1 / 6,
      caption: n === 6 ? "both" : n % 2 === 0 || n > 4 ? "in" : "",
    })),
    barsCaption: "Each face has probability 1/6. The 6 belongs to both events.",
    check: {
      prompt: "P(A) = 0.5, P(B) = 0.4, P(A and B) = 0.2. What is P(A or B)?",
      options: { A: "0.9", B: "0.7", C: "0.2", D: "0.5" },
      correct: "B",
      explanation: "0.5 + 0.4 − 0.2 = 0.7. Subtracting the overlap avoids counting it twice.",
    },
  },
  "random-variables": {
    explanation: [
      "A random variable assigns a number to each outcome of a random process. Its values are numbers; their probabilities are a separate list.",
      "For two coin tosses, X = number of heads maps HH→2, HT→1, TH→1, TT→0. So X takes values 0, 1, 2.",
    ],
    formula: "X : outcomes → numbers,   P(X = x) = P(outcomes mapped to x)",
    example: {
      prompt: "Toss two fair coins. Find the distribution of X = number of heads.",
      steps: [
        "Outcomes: HH, HT, TH, TT, each 1/4.",
        "X = 0 for TT → 1/4.",
        "X = 1 for HT, TH → 2/4.",
        "X = 2 for HH → 1/4.",
      ],
      answer: "Values {0, 1, 2} with probabilities 1/4, 1/2, 1/4",
    },
    bars: [
      { label: "0", value: 0.25 },
      { label: "1", value: 0.5 },
      { label: "2", value: 0.25 },
    ],
    barsCaption: "Values on the axis, probabilities as heights.",
    check: {
      prompt: "Roll one die. Y = 1 if the roll is a 6, otherwise 0. What values can Y take?",
      options: { A: "{1/6, 5/6}", B: "{0, 1}", C: "{6}", D: "{1, …, 6}" },
      correct: "B",
      explanation:
        "Y only ever outputs 0 or 1. The numbers 1/6 and 5/6 are the probabilities of those values.",
    },
  },
  "expected-value": {
    explanation: [
      "The expected value is a weighted average: multiply each value by its probability and add. It is where the long-run average of many repeats settles.",
      "It is linear: E[aX + b] = aE[X] + b. Scaling scales the mean; shifting shifts it.",
    ],
    formula: "E[X] = Σ x · P(X = x),   E[aX + b] = a·E[X] + b",
    example: {
      prompt: "X = 0 w.p. 0.5, 10 w.p. 0.3, 20 w.p. 0.2. Find E[X].",
      steps: ["0 × 0.5 = 0", "10 × 0.3 = 3", "20 × 0.2 = 4", "0 + 3 + 4 = 7"],
      answer: "E[X] = 7 (not 10, the unweighted average)",
    },
    bars: [
      { label: "0", value: 0.5 },
      { label: "10", value: 0.3 },
      { label: "20", value: 0.2 },
    ],
    barsCaption: "Most of the weight sits at 0, pulling the balance point down to 7.",
    check: {
      prompt: "E[X] = 4. What is E[3X − 2]?",
      options: { A: "12", B: "10", C: "14", D: "4" },
      correct: "B",
      explanation: "3 × 4 − 2 = 10. Linearity applies to both the scale and the shift.",
    },
  },
  variance: {
    explanation: [
      "Variance is the expected squared distance from the mean. First find E[X], then average the squared deviations, weighted by probability.",
      "Scaling by a multiplies variance by a². Adding a constant does not change spread at all. The standard deviation is the square root of the variance.",
    ],
    formula: "Var(X) = E[(X − μ)²] = E[X²] − (E[X])²,   Var(aX + b) = a²·Var(X)",
    example: {
      prompt: "X = 1 or 5, each with probability 1/2. Find Var(X).",
      steps: [
        "μ = 0.5·1 + 0.5·5 = 3",
        "Deviations: −2 and +2; squared: 4 and 4",
        "Weighted: 0.5·4 + 0.5·4 = 4",
      ],
      answer: "Var(X) = 4, SD = 2",
    },
    bars: [
      { label: "1", value: 0.5 },
      { label: "3 (μ)", value: 0 },
      { label: "5", value: 0.5 },
    ],
    barsCaption: "Both values sit 2 away from the mean of 3.",
    check: {
      prompt: "Var(X) = 3. What is Var(2X + 7)?",
      options: { A: "13", B: "6", C: "12", D: "19" },
      correct: "C",
      explanation: "2² × 3 = 12. The +7 shift adds nothing to spread.",
    },
  },
  "probability-distributions": {
    explanation: [
      "A distribution lists every value a random variable can take with its probability. Named families capture common situations.",
      "The binomial counts successes in n independent trials with success probability p. Each specific sequence has probability pᵏ(1 − p)ⁿ⁻ᵏ, and C(n, k) sequences give k successes.",
    ],
    formula: "P(X = k) = C(n, k) · pᵏ · (1 − p)ⁿ⁻ᵏ",
    example: {
      prompt: "X ~ Binomial(3, 0.5). Find P(X = 2).",
      steps: [
        "One arrangement, e.g. SSF: 0.5³ = 0.125",
        "Arrangements with 2 successes: C(3,2) = 3",
        "3 × 0.125 = 0.375",
      ],
      answer: "P(X = 2) = 0.375",
    },
    bars: [
      { label: "0", value: 0.125 },
      { label: "1", value: 0.375 },
      { label: "2", value: 0.375 },
      { label: "3", value: 0.125 },
    ],
    barsCaption: "Binomial(3, 0.5): symmetric, with 1 and 2 most likely.",
    check: {
      prompt: "X ~ Binomial(2, 0.5). What is P(X = 1)?",
      options: { A: "0.25", B: "0.5", C: "0.75", D: "1" },
      correct: "B",
      explanation: "C(2,1) × 0.5 × 0.5 = 2 × 0.25 = 0.5 (HT and TH).",
    },
  },
  "sampling-distributions": {
    explanation: [
      "Take a random sample and compute a statistic like the mean. A new sample gives a slightly different value. The sampling distribution describes that variation.",
      "The sample mean is centred on the population mean, and its spread, the standard error, shrinks as samples grow: σ / √n.",
    ],
    formula: "E[X̄] = μ,   SE(X̄) = σ / √n",
    example: {
      prompt: "μ = 50, σ = 10, n = 100. Find the standard error of the sample mean.",
      steps: ["√100 = 10", "SE = 10 / 10 = 1"],
      answer: "SE = 1",
    },
    bars: [
      { label: "n=1", value: 1 },
      { label: "n=4", value: 0.5 },
      { label: "n=25", value: 0.2 },
      { label: "n=100", value: 0.1 },
    ],
    barsCaption: "Standard error relative to σ: it falls with √n.",
    check: {
      prompt: "σ = 12, n = 36. What is the standard error of the mean?",
      options: { A: "12", B: "2", C: "1/3", D: "6" },
      correct: "B",
      explanation: "12 / √36 = 12 / 6 = 2.",
    },
  },
  "central-limit-theorem": {
    explanation: [
      "The Central Limit Theorem says that for large enough samples of independent values with finite variance, the sample mean is approximately normal, whatever the population's shape.",
      "It combines two earlier ideas: the mean of X̄ is μ (expected value) and its standard error is σ/√n (variance). Together they let us use normal probabilities for averages.",
    ],
    formula: "X̄ ≈ Normal(μ, σ² / n) for large n",
    example: {
      prompt: "Exam scores have μ = 70, σ = 15. For n = 25 students, roughly what is P(X̄ > 76)?",
      steps: ["SE = 15 / √25 = 3", "z = (76 − 70) / 3 = 2", "P(Z > 2) ≈ 0.023"],
      answer: "About 2.3%",
    },
    bars: [
      { label: "", value: 0.05 },
      { label: "", value: 0.2 },
      { label: "", value: 0.55 },
      { label: "μ", value: 1 },
      { label: "", value: 0.55 },
      { label: "", value: 0.2 },
      { label: "", value: 0.05 },
    ],
    barsCaption: "Sample means pile up symmetrically around μ.",
    check: {
      prompt: "Which condition matters most for the CLT approximation to be good?",
      options: {
        A: "The population is normal",
        B: "The sample size is large enough",
        C: "σ is small",
        D: "μ is zero",
      },
      correct: "B",
      explanation:
        "The CLT works for most population shapes once n is large enough; a normal population is not required.",
    },
  },
};
