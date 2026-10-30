import { describe, expect, it } from "vitest";
import { CONCEPT_IDS } from "@/data/concepts";
import { getPractice, practiceComplete } from "@/data/practice";

describe("lesson practice", () => {
  it("every concept has two questions whose correct option exists", () => {
    for (const id of CONCEPT_IDS) {
      const questions = getPractice(id);
      expect(questions).toHaveLength(2);
      for (const q of questions) expect(q.options[q.correct]).toBeTruthy();
    }
  });
  it("completion needs every question answered correctly", () => {
    const [a, b] = getPractice("variance");
    expect(practiceComplete("variance", { [a!.id]: a!.correct })).toBe(false);
    expect(
      practiceComplete("variance", {
        [a!.id]: a!.correct,
        [b!.id]: "A" === b!.correct ? "B" : "A",
      }),
    ).toBe(false);
    expect(practiceComplete("variance", { [a!.id]: a!.correct, [b!.id]: b!.correct })).toBe(true);
  });
});
