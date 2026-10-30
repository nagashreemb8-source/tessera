import type { ConceptId, FollowUp, Question } from "@/types";

export const QUESTIONS: Question[] = [
  {
    id: 1,
    conceptIds: ["basic-probability"],
    prompt:
      "A fair six-sided die is rolled. What is the probability the result is even OR greater than 4?",
    options: { A: "1/2", B: "2/3", C: "5/6", D: "1/3" },
    correct: "B",
    commonErrors: {
      C: "Added 3/6 + 2/6 without subtracting the overlap, so the 6 was counted twice.",
    },
  },
  {
    id: 2,
    conceptIds: ["random-variables"],
    prompt: "X is the number of heads in 2 fair coin tosses. What are the possible values of X?",
    options: { A: "{H, T}", B: "{0, 1}", C: "{0, 1, 2}", D: "{0.25, 0.5, 0.25}" },
    correct: "C",
    commonErrors: {
      D: "Listed the probabilities of each value instead of the values X can take.",
      A: "Listed the raw outcomes rather than the numbers the variable assigns to them.",
    },
  },
  {
    id: 3,
    conceptIds: ["expected-value"],
    prompt:
      "X equals 0 with probability 0.5, 10 with probability 0.3, and 20 with probability 0.2. What is E[X]?",
    options: { A: "7", B: "10", C: "15", D: "0.5" },
    correct: "A",
    commonErrors: {
      B: "Took the simple average of 0, 10 and 20, ignoring the probabilities attached to each value.",
    },
  },
  {
    id: 4,
    conceptIds: ["expected-value"],
    prompt: "A fair die has E[X] = 3.5. What is E[2X + 1]?",
    options: { A: "7", B: "8", C: "9", D: "4.5" },
    correct: "B",
    commonErrors: {
      A: "Scaled the mean by 2 but dropped the +1 shift (E[2X + 1] = 2E[X] + 1).",
    },
  },
  {
    id: 5,
    conceptIds: ["variance"],
    leansOn: "expected-value",
    prompt: "X is 1 or 5, each with probability 1/2. What is Var(X)?",
    options: { A: "2", B: "3", C: "4", D: "8" },
    correct: "C",
    commonErrors: {
      A: "Reported the standard deviation (2) instead of the variance (4).",
      D: "Summed the squared deviations from the mean without weighting each by its probability.",
    },
  },
  {
    id: 6,
    conceptIds: ["variance"],
    prompt: "If Var(X) = 2, what is Var(3X)?",
    options: { A: "5", B: "6", C: "12", D: "18" },
    correct: "D",
    commonErrors: {
      B: "Treated variance as linear. Scaling by 3 multiplies variance by 3² = 9.",
    },
  },
  {
    id: 7,
    conceptIds: ["probability-distributions"],
    prompt: "Let X be Binomial(n = 3, p = 0.5). What is P(X = 2)?",
    options: { A: "0.25", B: "0.375", C: "0.5", D: "0.75" },
    correct: "B",
    commonErrors: {
      A: "Computed one arrangement's probability but forgot the C(3,2) = 3 ways to get two successes.",
    },
  },
  {
    id: 8,
    conceptIds: ["sampling-distributions"],
    prompt:
      "A population has mean 50 and standard deviation 10. For samples of size 100, what is the standard error of the sample mean?",
    options: { A: "10", B: "1", C: "0.1", D: "5" },
    correct: "B",
    commonErrors: {
      A: "Used the population standard deviation instead of dividing by √n (10 / √100 = 1).",
    },
  },
];

export const QUESTION_BY_ID = Object.fromEntries(QUESTIONS.map((q) => [q.id, q])) as Record<
  number,
  Question
>;

export const FOLLOW_UPS: Partial<Record<ConceptId, FollowUp>> = {
  "basic-probability": {
    conceptId: "basic-probability",
    prompt: "One card is drawn from a standard 52-card deck. What is P(heart OR king)?",
    options: { A: "17/52", B: "4/13", C: "1/52", D: "1/4" },
    correct: "B",
    misconception: ["A"],
    misconceptionNote:
      "Counting 13 + 4 double-counts the king of hearts, the same overlap error as Question 1.",
  },
  "random-variables": {
    conceptId: "random-variables",
    prompt: "Y is the number of sixes in a single die roll. What values can Y take?",
    options: { A: "{1, 2, 3, 4, 5, 6}", B: "{0, 1}", C: "{1/6, 5/6}", D: "{6}" },
    correct: "B",
    misconception: ["C"],
    misconceptionNote:
      "Listing probabilities instead of values repeats the pattern from Question 2.",
  },
  "expected-value": {
    conceptId: "expected-value",
    prompt:
      "A game pays $0 with probability 0.7 and $10 with probability 0.3. What is the expected payout?",
    options: { A: "$5", B: "$3", C: "$10", D: "$0.30" },
    correct: "B",
    misconception: ["A"],
    misconceptionNote:
      "$5 is the unweighted average of $0 and $10, the same pattern seen in Question 3.",
  },
  variance: {
    conceptId: "variance",
    prompt: "If Var(X) = 4, what is Var(2X + 3)?",
    options: { A: "11", B: "8", C: "16", D: "19" },
    correct: "C",
    misconception: ["A", "B"],
    misconceptionNote:
      "Scaling variance linearly repeats the pattern from Question 6. Shifts add nothing; scaling squares.",
  },
  "probability-distributions": {
    conceptId: "probability-distributions",
    prompt: "Let X be Binomial(n = 4, p = 0.5). What is P(X = 1)?",
    options: { A: "0.0625", B: "0.25", C: "0.5", D: "0.125" },
    correct: "B",
    misconception: ["A"],
    misconceptionNote:
      "0.0625 is one arrangement only. The C(4,1) = 4 arrangements were left out again.",
  },
  "sampling-distributions": {
    conceptId: "sampling-distributions",
    prompt:
      "A population has standard deviation 20. For samples of size 25, what is the standard error of the mean?",
    options: { A: "20", B: "4", C: "0.8", D: "1" },
    correct: "B",
    misconception: ["A"],
    misconceptionNote:
      "Using σ directly without dividing by √n repeats the pattern from Question 8.",
  },
};
