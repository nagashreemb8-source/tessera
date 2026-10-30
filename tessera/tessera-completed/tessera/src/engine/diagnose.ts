// Pure, deterministic demo engine. No UI, no network.
import {
  CONCEPTS,
  CONCEPT_BY_ID,
  CONCEPT_IDS,
  conceptName,
  dependentsOf,
  depthOf,
} from "@/data/concepts";
import { FOLLOW_UPS, QUESTIONS, QUESTION_BY_ID } from "@/data/questions";
import type {
  Answers,
  ConceptId,
  ConceptResult,
  Diagnosis,
  EvidenceLevel,
  HypothesisResult,
  ObservedMistake,
  OptionKey,
  PathStep,
  QuizResults,
  Status,
  SuspectedGap,
} from "@/types";

/**
 * Per-concept rows are created lazily. A quiz produced by a connected backend can carry
 * concept ids that the demo subject does not know about, so a missing row must not crash.
 */
function conceptRow(concepts: Record<ConceptId, ConceptResult>, id: ConceptId): ConceptResult {
  const existing = concepts[id];
  if (existing) return existing;
  const created: ConceptResult = { conceptId: id, correct: 0, answered: 0, wrongIds: [] };
  concepts[id] = created;
  return created;
}

/** Numeric ids sort numerically; backend string ids fall back to a stable text order. */
function compareQuestionIds(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function scoreQuiz(answers: Answers): QuizResults {
  const concepts = Object.fromEntries(
    CONCEPT_IDS.map((id) => [id, { conceptId: id, correct: 0, answered: 0, wrongIds: [] }]),
  ) as unknown as Record<ConceptId, ConceptResult>;

  const questions = QUESTIONS.map((q) => {
    const chosen = answers[q.id];
    const answered = chosen !== undefined;
    const correct = answered && chosen === q.correct;
    for (const c of q.conceptIds) {
      if (!answered) continue;
      const row = conceptRow(concepts, c);
      row.answered += 1;
      if (correct) row.correct += 1;
      else row.wrongIds.push(q.id);
    }
    return { id: q.id, chosen, answered, correct };
  });

  return {
    questions,
    concepts,
    score: questions.filter((q) => q.correct).length,
    answered: questions.filter((q) => q.answered).length,
    total: QUESTIONS.length,
  };
}

export function evidenceLevel(supportingCount: number): EvidenceLevel {
  if (supportingCount >= 4) return "Stronger";
  if (supportingCount >= 2) return "Some";
  return "Limited";
}

export const EVIDENCE_COPY: Record<EvidenceLevel, string> = {
  Limited: "Based on a single answer, so treat it as a lead, not a conclusion.",
  Some: "Two or three answers point the same way. Worth checking with a follow-up.",
  Stronger:
    "Four or more answers line up across related concepts. Still a hypothesis until tested.",
};

function alternativesFor(suspected: ConceptId, dependents: ConceptId[]): string[] {
  const alts = [
    "Careless arithmetic under time pressure rather than a conceptual gap.",
    "Unfamiliarity with the notation (for example E[·] or Var(·)) rather than the idea behind it.",
  ];
  for (const d of dependents)
    alts.push(`A gap in ${conceptName(d)} itself, independent of ${conceptName(suspected)}.`);
  return alts;
}

export function diagnose(results: QuizResults): Diagnosis {
  const observed: ObservedMistake[] = results.questions
    .filter((q) => !q.correct)
    .map((q) => {
      const def = QUESTION_BY_ID[Number(q.id)]!;
      return {
        questionId: q.id,
        conceptIds: def.conceptIds,
        chosen: q.chosen,
        correctAnswer: def.correct,
        unanswered: !q.answered,
        pattern: !q.answered
          ? "Not answered, so this question adds no evidence either way."
          : (def.commonErrors[q.chosen as OptionKey] ??
            "A less common answer. Not enough to name a specific pattern."),
      };
    });

  const statuses = {} as Record<ConceptId, Status>;
  for (const id of CONCEPT_IDS) {
    const r = conceptRow(results.concepts, id);
    statuses[id] =
      r.answered === 0 ? "untested" : r.wrongIds.length === 0 ? "mastered" : "developing";
  }

  const wrong = (id: ConceptId) => conceptRow(results.concepts, id).wrongIds;
  const tested = (id: ConceptId) => conceptRow(results.concepts, id).answered > 0;

  // 1) Dependent wrong AND prerequisite wrong -> suspect the prerequisite.
  const prereqGaps = new Map<ConceptId, { deps: ConceptId[]; ids: Set<number | string> }>();
  for (const c of CONCEPTS) {
    if (wrong(c.id).length === 0) continue;
    for (const p of c.prerequisites) {
      if (!tested(p) || wrong(p).length === 0) continue;
      const entry = prereqGaps.get(p) ?? { deps: [], ids: new Set(wrong(p)) };
      entry.deps.push(c.id);
      wrong(c.id).forEach((i) => entry.ids.add(i));
      prereqGaps.set(p, entry);
    }
  }

  const gaps: SuspectedGap[] = [];
  for (const [p, { deps, ids }] of prereqGaps) {
    deps.sort((a, b) => wrong(b).length - wrong(a).length);
    const supporting = [...ids].sort(compareQuestionIds);
    const level = evidenceLevel(supporting.length);
    gaps.push({
      conceptId: p,
      kind: "prerequisite",
      supportingQuestionIds: supporting,
      dependentConceptIds: deps,
      supportedPrerequisites: [],
      alternatives: alternativesFor(p, deps),
      evidence: level,
      needsMoreEvidence: supporting.length < 2,
      summary: `Wrong answers in ${deps.map(conceptName).join(" and ")} and in ${conceptName(p)} itself are consistent with a possible foundational gap in ${conceptName(p)}, which ${deps.length > 1 ? "they" : "it"} build${deps.length > 1 ? "" : "s"} on.`,
      followUp: FOLLOW_UPS[p],
    });
  }

  // 2) Dependent wrong but prerequisites correct -> gap more likely in the concept itself.
  for (const c of CONCEPTS) {
    const w = wrong(c.id);
    if (w.length === 0 || prereqGaps.has(c.id)) continue;
    if (c.prerequisites.some((p) => wrong(p).length > 0)) continue; // already explained upstream
    const supported = c.prerequisites.filter((p) => tested(p));
    const single = w.length === 1;
    gaps.push({
      conceptId: c.id,
      kind: "self",
      supportingQuestionIds: [...w],
      dependentConceptIds: [],
      supportedPrerequisites: supported,
      alternatives: alternativesFor(c.id, []).slice(0, 2),
      evidence: evidenceLevel(w.length),
      needsMoreEvidence: single,
      summary: single
        ? `One wrong answer in ${c.name}. More evidence needed before suspecting a gap.`
        : `${w.length} wrong answers in ${c.name}${supported.length ? ` while ${supported.map(conceptName).join(", ")} looked solid` : ""}. The difficulty is more likely in ${c.name} itself.`,
      followUp: FOLLOW_UPS[c.id],
    });
  }

  gaps.sort(
    (a, b) =>
      (a.kind === "prerequisite" ? 0 : 1) - (b.kind === "prerequisite" ? 0 : 1) ||
      b.supportingQuestionIds.length - a.supportingQuestionIds.length ||
      depthOf(a.conceptId) - depthOf(b.conceptId),
  );

  return { observed, statuses, gaps };
}

export function evaluateHypothesis(
  conceptId: ConceptId,
  followUpAnswer: OptionKey,
): HypothesisResult {
  const fu = FOLLOW_UPS[conceptId];
  const name = conceptName(conceptId);
  if (!fu) {
    return {
      conceptId,
      answer: followUpAnswer,
      outcome: "more-evidence",
      title: "More evidence needed",
      explanation: `No follow-up question exists yet for ${name}.`,
    };
  }
  if (followUpAnswer === fu.correct) {
    return {
      conceptId,
      answer: followUpAnswer,
      outcome: "supported",
      title: "Prerequisite understanding supported",
      explanation: `You answered the follow-up correctly. That supports your understanding of ${name}; the earlier mistakes may come from somewhere else, such as arithmetic slips or the dependent concept itself.`,
    };
  }
  if (fu.misconception.includes(followUpAnswer)) {
    return {
      conceptId,
      answer: followUpAnswer,
      outcome: "possible-gap",
      title: "Possible gap detected",
      explanation: `${fu.misconceptionNote} The same pattern appearing again makes a gap in ${name} more likely. Reviewing it first is a sensible next step.`,
    };
  }
  return {
    conceptId,
    answer: followUpAnswer,
    outcome: "more-evidence",
    title: "More evidence needed",
    explanation: `This answer is a different error from the one seen in the diagnostic, so it neither confirms nor rules out a gap in ${name}. Another question would help.`,
  };
}

/** Current statuses after follow-ups and completed learning steps. */
export function effectiveStatuses(
  base: Record<ConceptId, Status>,
  hypotheses: Partial<Record<ConceptId, HypothesisResult>>,
  completed: ConceptId[],
): Record<ConceptId, Status> {
  const out = { ...base };
  for (const id of CONCEPT_IDS) {
    const h = hypotheses[id];
    if (h?.outcome === "supported") out[id] = "mastered";
    else if (h) out[id] = "developing";
    if (completed.includes(id)) out[id] = "mastered";
  }
  return out;
}

/** Dependency-aware learning path. Never orders a step ahead of its prerequisites. */
export function buildLearningPath(d: Diagnosis): PathStep[] {
  const gapIds = new Set(d.gaps.filter((g) => g.kind === "prerequisite").map((g) => g.conceptId));
  const nonMastered = CONCEPT_IDS.filter((id) => d.statuses[id] !== "mastered");
  const startIds = gapIds.size ? [...gapIds] : nonMastered;
  if (startIds.length === 0) return [];
  const minDepth = Math.min(...startIds.map(depthOf));
  const selected = CONCEPT_IDS.filter((id) => depthOf(id) >= minDepth);
  const sel = new Set(selected);

  const priority = (id: ConceptId) =>
    gapIds.has(id)
      ? 0
      : d.statuses[id] === "developing"
        ? 1
        : d.statuses[id] === "mastered"
          ? 2
          : 3;

  const done = new Set<ConceptId>();
  const order: ConceptId[] = [];
  while (order.length < selected.length) {
    const ready = selected
      .filter((id) => !done.has(id))
      .filter((id) =>
        (CONCEPT_BY_ID[id]?.prerequisites ?? []).every((p) => !sel.has(p) || done.has(p)),
      )
      .sort((a, b) => priority(a) - priority(b) || CONCEPT_IDS.indexOf(a) - CONCEPT_IDS.indexOf(b));
    const next = ready[0]!;
    done.add(next);
    order.push(next);
  }

  return order.map((id) => {
    const c = CONCEPT_BY_ID[id]!;
    const prereqs = c.prerequisites.filter((p) => sel.has(p));
    const wrongCount = d.observed.filter((o) => !o.unanswered && o.conceptIds.includes(id)).length;
    const deps = dependentsOf(id)
      .filter((x) => sel.has(x))
      .map(conceptName);
    let verb: PathStep["verb"];
    let reason: string;
    if (gapIds.has(id)) {
      verb = "Review";
      reason = `Suspected foundational gap. ${deps.join(" and ")} build${deps.length > 1 ? "" : "s"} on it, so it comes first.`;
    } else if (d.statuses[id] === "untested") {
      verb = "Reassess";
      reason = `Not assessed in this diagnostic. Check it once ${prereqs.map(conceptName).join(" and ")} feel solid.`;
    } else if (d.statuses[id] === "mastered") {
      verb = "Practice";
      reason = `Answered correctly, but ${deps.join(" and ") || "later topics"} rel${deps.length > 1 ? "y" : "ies"} on it. A short practice keeps it solid.`;
    } else if (wrongCount >= 2) {
      verb = "Revisit";
      reason = `${wrongCount} answers here were wrong. Revisit after ${prereqs.map(conceptName).join(" and ") || "the basics"}, since it depends on ${prereqs.length > 1 ? "them" : "it"}.`;
    } else {
      verb = "Continue to";
      reason = `One answer here was wrong. Builds on ${prereqs.map(conceptName).join(" and ")}, so it follows them.`;
    }
    return { conceptId: id, verb, reason, prerequisitesInPath: prereqs };
  });
}
