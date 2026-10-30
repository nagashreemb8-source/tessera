import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import { buildLearningPath, diagnose, effectiveStatuses, scoreQuiz } from "@/engine/diagnose";
import { SAMPLE_ANSWERS } from "@/data/sampleStudent";
import { conceptName, isConceptId } from "@/data/concepts";
import { QUESTIONS } from "@/data/questions";
import type {
  Answers,
  ConceptId,
  Diagnosis,
  HypothesisResult,
  OptionKey,
  PathStep,
  QuizResults,
  Status,
} from "@/types";

export interface Activity {
  id: number;
  label: string;
  detail: string;
}

interface State {
  answers: Answers;
  results: QuizResults | null;
  diagnosis: Diagnosis | null;
  hypotheses: Partial<Record<ConceptId, HypothesisResult>>;
  completedSteps: ConceptId[];
  /** Practice answers keyed by practice question id, e.g. "variance-1". */
  lessonAnswers: Record<string, OptionKey>;
  activity: Activity[];
  simulateFailure: boolean;
}

type Action =
  | { type: "hydrate"; state: State }
  | { type: "answer"; questionId: number; option: OptionKey }
  | { type: "loadSampleAnswers" }
  | { type: "submit" }
  | { type: "loadSampleResults" }
  | { type: "restart" }
  | { type: "hypothesis"; result: HypothesisResult }
  | { type: "toggleStep"; conceptId: ConceptId }
  | { type: "completeLesson"; conceptId: ConceptId }
  | { type: "practiceAnswer"; key: string; option: OptionKey }
  | { type: "practiceReset"; key: string }
  | { type: "log"; label: string; detail: string }
  | { type: "simulateFailure"; value: boolean }
  | { type: "reset" };

const initial: State = {
  answers: {},
  results: null,
  diagnosis: null,
  hypotheses: {},
  completedSteps: [],
  lessonAnswers: {},
  activity: [],
  simulateFailure: false,
};

function log(s: State, label: string, detail: string): Activity[] {
  const id = s.activity.reduce((m, a) => Math.max(m, a.id), 0) + 1;
  return [{ id, label, detail }, ...s.activity].slice(0, 12);
}

function runDiagnosis(s: State, answers: Answers, label: string): State {
  const results = scoreQuiz(answers);
  const diagnosis = diagnose(results);
  const top = diagnosis.gaps[0];
  return {
    ...s,
    answers,
    results,
    diagnosis,
    hypotheses: {},
    completedSteps: [],
    lessonAnswers: {},
    activity: log(
      s,
      label,
      `${results.score} of ${results.total} correct${top ? ` · suspected: ${conceptName(top.conceptId)}` : ""}`,
    ),
  };
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "hydrate":
      return { ...a.state, simulateFailure: false };
    case "answer":
      return { ...s, answers: { ...s.answers, [a.questionId]: a.option } };
    case "loadSampleAnswers":
      return { ...s, answers: { ...SAMPLE_ANSWERS } };
    case "submit":
      return runDiagnosis(s, s.answers, "Diagnostic submitted");
    case "loadSampleResults":
      return runDiagnosis(s, { ...SAMPLE_ANSWERS }, "Sample results loaded");
    case "restart":
      return {
        ...initial,
        activity: log(s, "Diagnostic restarted", "Previous answers and progress were cleared"),
      };
    case "hypothesis":
      return {
        ...s,
        hypotheses: { ...s.hypotheses, [a.result.conceptId]: a.result },
        activity: log(s, `Hypothesis tested: ${conceptName(a.result.conceptId)}`, a.result.title),
      };
    case "toggleStep": {
      const done = s.completedSteps.includes(a.conceptId);
      return {
        ...s,
        completedSteps: done
          ? s.completedSteps.filter((c) => c !== a.conceptId)
          : [...s.completedSteps, a.conceptId],
        activity: done ? s.activity : log(s, "Learning step completed", conceptName(a.conceptId)),
      };
    }
    case "completeLesson":
      if (s.completedSteps.includes(a.conceptId)) return s;
      return {
        ...s,
        completedSteps: [...s.completedSteps, a.conceptId],
        activity: log(
          s,
          "Lesson completed",
          `${conceptName(a.conceptId)} · practice answered correctly`,
        ),
      };
    case "practiceAnswer":
      return { ...s, lessonAnswers: { ...s.lessonAnswers, [a.key]: a.option } };
    case "practiceReset": {
      const next = { ...s.lessonAnswers };
      delete next[a.key];
      return { ...s, lessonAnswers: next };
    }
    case "log":
      return { ...s, activity: log(s, a.label, a.detail) };
    case "simulateFailure":
      return { ...s, simulateFailure: a.value };
    case "reset":
      return initial;
  }
}

/* ---------- Local persistence (demo progress survives a refresh) ---------- */

const STORAGE_KEY = "tessera.demo.v1";

function isOption(v: unknown): v is OptionKey {
  return v === "A" || v === "B" || v === "C" || v === "D";
}

/**
 * Only raw inputs are persisted. Results and diagnosis are recomputed with the deterministic
 * engine on load, so stored data can never drift out of sync with the scoring logic.
 */
function serialize(s: State): string {
  return JSON.stringify({
    version: 1,
    answers: s.answers,
    submitted: s.results !== null,
    hypotheses: s.hypotheses,
    completedSteps: s.completedSteps,
    lessonAnswers: s.lessonAnswers,
    activity: s.activity,
  });
}

function loadState(): State | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (p["version"] !== 1) return null;

    const rawAnswers = (p["answers"] ?? {}) as Record<string, unknown>;
    const answers: Answers = {};
    for (const q of QUESTIONS) {
      const v = rawAnswers[String(q.id)];
      if (isOption(v)) answers[q.id] = v;
    }

    const hypotheses: State["hypotheses"] = {};
    const rawHyp = (p["hypotheses"] ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(rawHyp)) {
      if (
        isConceptId(k) &&
        typeof v === "object" &&
        v !== null &&
        typeof (v as HypothesisResult).outcome === "string"
      ) {
        hypotheses[k] = v as HypothesisResult;
      }
    }

    const completedSteps = (Array.isArray(p["completedSteps"]) ? p["completedSteps"] : []).filter(
      (c): c is ConceptId => typeof c === "string" && isConceptId(c),
    );

    const lessonAnswers: Record<string, OptionKey> = {};
    for (const [k, v] of Object.entries((p["lessonAnswers"] ?? {}) as Record<string, unknown>)) {
      if (isOption(v)) lessonAnswers[k] = v;
    }

    const activity = (Array.isArray(p["activity"]) ? p["activity"] : []).filter(
      (a): a is Activity =>
        typeof a === "object" &&
        a !== null &&
        typeof (a as Activity).id === "number" &&
        typeof (a as Activity).label === "string" &&
        typeof (a as Activity).detail === "string",
    );

    const submitted = p["submitted"] === true && Object.keys(answers).length > 0;
    const results = submitted ? scoreQuiz(answers) : null;
    const diagnosis = results ? diagnose(results) : null;

    return {
      answers,
      results,
      diagnosis,
      hypotheses: diagnosis ? hypotheses : {},
      completedSteps,
      lessonAnswers,
      activity,
      simulateFailure: false,
    };
  } catch {
    return null;
  }
}

interface Ctx {
  state: State;
  dispatch: React.Dispatch<Action>;
  statuses: Record<ConceptId, Status> | null;
  path: PathStep[];
  /** False until saved progress has been read from the browser (avoids SSR/hydration mismatch). */
  hydrated: boolean;
}

const AppStateContext = createContext<Ctx | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadState();
    if (saved) dispatch({ type: "hydrate", state: saved });
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, serialize(state));
    } catch {
      /* storage full or blocked: the app keeps working in memory */
    }
  }, [state, hydrated]);

  const value = useMemo<Ctx>(() => {
    const statuses = state.diagnosis
      ? effectiveStatuses(state.diagnosis.statuses, state.hypotheses, state.completedSteps)
      : null;
    const path = state.diagnosis ? buildLearningPath(state.diagnosis) : [];
    return { state, dispatch, statuses, path, hydrated };
  }, [state, hydrated]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useTessera() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useTessera must be used inside AppStateProvider");
  return ctx;
}
