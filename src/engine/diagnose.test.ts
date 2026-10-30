import { describe, expect, it } from "vitest";
import { buildLearningPath, diagnose, evaluateHypothesis, scoreQuiz } from "./diagnose";
import { SAMPLE_ANSWERS } from "@/data/sampleStudent";
import { QUESTIONS } from "@/data/questions";
import type { Answers } from "@/types";

const allCorrect: Answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.correct]));

describe("demo engine", () => {
  it("all correct: everything tested is mastered, no gaps, CLT untested", () => {
    const r = scoreQuiz(allCorrect);
    expect(r.score).toBe(8);
    const d = diagnose(r);
    expect(d.gaps).toHaveLength(0);
    expect(d.observed).toHaveLength(0);
    expect(d.statuses["variance"]).toBe("mastered");
    expect(d.statuses["central-limit-theorem"]).toBe("untested");
  });

  it("sample answers: Expected Value is the headline suspected gap", () => {
    const d = diagnose(scoreQuiz(SAMPLE_ANSWERS));
    expect(d.statuses).toEqual({
      "basic-probability": "mastered",
      "random-variables": "mastered",
      "expected-value": "developing",
      variance: "developing",
      "probability-distributions": "mastered",
      "sampling-distributions": "developing",
      "central-limit-theorem": "untested",
    });
    const top = d.gaps[0]!;
    expect(top.conceptId).toBe("expected-value");
    expect(top.dependentConceptIds[0]).toBe("variance");
    expect(top.supportingQuestionIds).toEqual(expect.arrayContaining([3, 4, 5, 6]));
    expect(top.followUp?.correct).toBe("B");
  });

  it("sample answers: learning path respects prerequisites", () => {
    const path = buildLearningPath(diagnose(scoreQuiz(SAMPLE_ANSWERS))).map((s) => s.conceptId);
    expect(path).toEqual([
      "expected-value",
      "variance",
      "probability-distributions",
      "sampling-distributions",
      "central-limit-theorem",
    ]);
  });

  it("single wrong answer needs more evidence", () => {
    const d = diagnose(scoreQuiz({ ...allCorrect, 6: "B" }));
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0]!.conceptId).toBe("variance");
    expect(d.gaps[0]!.kind).toBe("self");
    expect(d.gaps[0]!.needsMoreEvidence).toBe(true);
    expect(d.gaps[0]!.evidence).toBe("Limited");
    expect(d.gaps[0]!.supportedPrerequisites).toContain("expected-value");
  });

  it("hypothesis: correct follow-up is supported", () => {
    expect(evaluateHypothesis("expected-value", "B").outcome).toBe("supported");
  });
  it("hypothesis: repeated misconception is a possible gap", () => {
    expect(evaluateHypothesis("expected-value", "A").outcome).toBe("possible-gap");
  });
  it("hypothesis: different error needs more evidence", () => {
    expect(evaluateHypothesis("expected-value", "C").outcome).toBe("more-evidence");
    expect(evaluateHypothesis("expected-value", "D").outcome).toBe("more-evidence");
  });
});
