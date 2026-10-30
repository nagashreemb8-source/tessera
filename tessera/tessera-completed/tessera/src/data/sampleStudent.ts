import type { Answers } from "@/types";

export const SAMPLE_STUDENT = {
  name: "Maya R.",
  label: "Maya R. (demo student)",
  subject: "Probability & Statistics",
};

export const SAMPLE_ANSWERS: Answers = {
  1: "B",
  2: "C",
  3: "B",
  4: "A",
  5: "D",
  6: "B",
  7: "B",
  8: "A",
};

/** Sample weekly study minutes, shown only with a "Sample data" label. */
export const SAMPLE_WEEK = [
  { day: "Mon", minutes: 20 },
  { day: "Tue", minutes: 35 },
  { day: "Wed", minutes: 10 },
  { day: "Thu", minutes: 40 },
  { day: "Fri", minutes: 25 },
  { day: "Sat", minutes: 0 },
  { day: "Sun", minutes: 30 },
];
