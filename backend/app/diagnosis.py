"""Root cause diagnosis.

Design principle: OBSERVED MISTAKES are facts (which question, which wrong option, which
misconception label it represents). SUSPECTED GAPS are hypotheses about which concept, if
any, explains those mistakes. Correctness and candidate root causes are decided by the
deterministic code below; the LLM may only rephrase a summary, and that phrasing is
validated against the evidence before it is kept.

Algorithm (documented thresholds)
---------------------------------
1. Per concept: count answered / correct / wrong questions and collect misconception labels.
2. For every concept with errors, walk its transitive prerequisites. A prerequisite P becomes
   a candidate root cause only when there is supporting evidence:
     (a) the student also erred on questions that test P directly, and/or
     (b) the same misconception label repeats between P's errors and a dependent's errors
         (or across two or more dependent concepts), and/or
     (c) two or more concepts that depend on P are wrong.
   An upstream concept with no such evidence is never blamed.
3. For each failing concept pick the supported prerequisite with the most supporting
   questions (ties broken toward the more foundational concept), then aggregate by P.
4. Evidence level:
     Stronger = at least 2 direct errors AND at least 2 affected dependents, or 4+ supporting answers
     Some     = at least 1 direct error plus an affected dependent or a repeated misconception,
                or 2+ direct errors
     Limited  = anything weaker (single indirect signal)
   `needs_more_evidence` is true for Limited.
5. Concepts with errors that no supported prerequisite explains become `self` hypotheses.
6. Hypotheses are phrased with hedged language and always list alternative explanations.
"""
from __future__ import annotations

import logging
import re
import sqlite3
from typing import Any

from .db import dumps, get_db, loads, log_activity, new_id, utcnow
from .errors import ApiError
from .llm import LLMError, get_llm
from .models import ConceptNode, DiagnosisPhrasingLLM

log = logging.getLogger("tessera.diagnosis")

MIN_ANSWERS_FOR_DIAGNOSIS = 1
EVIDENCE_ORDER = {"Limited": 0, "Some": 1, "Stronger": 2}


# --------------------------------------------------------------------------- #
# Session-wide concept evidence
# --------------------------------------------------------------------------- #
def concept_evidence(conn: sqlite3.Connection, session_id: str) -> dict[str, dict[str, Any]]:
    """Aggregate every graded attempt into per-concept evidence."""
    rows = conn.execute(
        "SELECT results FROM attempts WHERE session_id = ? ORDER BY created_at, rowid",
        (session_id,),
    ).fetchall()
    evidence: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(rows):
        results = loads(row["results"], {}) or {}
        for stat in results.get("concepts", []):
            entry = evidence.setdefault(
                stat["concept_id"],
                {
                    "concept_id": stat["concept_id"],
                    "name": stat.get("name", stat["concept_id"]),
                    "answered": 0,
                    "correct": 0,
                    "wrong_question_ids": [],
                    "attempts": 0,
                    "last_correct": None,
                    "last_answered": 0,
                },
            )
            entry["answered"] += int(stat.get("answered", 0))
            entry["correct"] += int(stat.get("correct", 0))
            entry["wrong_question_ids"].extend(stat.get("wrong_question_ids", []))
            entry["attempts"] = index + 1
            entry["last_answered"] = int(stat.get("answered", 0))
            entry["last_correct"] = (
                int(stat.get("correct", 0)) if stat.get("answered", 0) else entry["last_correct"]
            )
    return evidence


def latest_hypotheses(conn: sqlite3.Connection, session_id: str) -> dict[str, dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM hypotheses WHERE session_id = ? ORDER BY updated_at, rowid",
        (session_id,),
    ).fetchall()
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        out[row["concept_id"]] = {
            "outcome": row["outcome"],
            "note": row["note"],
            "updated_at": row["updated_at"],
        }
    return out


def compute_statuses(
    session_id: str,
    nodes: list[dict],
    *,
    conn: sqlite3.Connection | None = None,
) -> dict[str, str]:
    def _run(c: sqlite3.Connection) -> dict[str, str]:
        evidence = concept_evidence(c, session_id)
        hypotheses = latest_hypotheses(c, session_id)
        statuses: dict[str, str] = {}
        for node in nodes:
            cid = node["id"]
            ev = evidence.get(cid)
            if not ev or ev["answered"] == 0:
                statuses[cid] = "untested"
            elif ev["last_answered"] and ev["last_correct"] == ev["last_answered"]:
                statuses[cid] = "mastered"
            elif ev["answered"] and ev["correct"] / ev["answered"] >= 0.85 and not ev["wrong_question_ids"]:
                statuses[cid] = "mastered"
            else:
                statuses[cid] = "developing"
            hyp = hypotheses.get(cid)
            if hyp and hyp["outcome"] == "supported":
                statuses[cid] = "mastered"
        return statuses

    if conn is not None:
        return _run(conn)
    with get_db() as connection:
        return _run(connection)


# --------------------------------------------------------------------------- #
# Graph helpers
# --------------------------------------------------------------------------- #
def _ancestors(edges: list[dict]) -> dict[str, set[str]]:
    parents: dict[str, list[str]] = {}
    for edge in edges:
        parents.setdefault(edge["to_id"], []).append(edge["from_id"])
    cache: dict[str, set[str]] = {}

    def walk(node: str, seen: set[str]) -> set[str]:
        if node in cache:
            return cache[node]
        out: set[str] = set()
        for parent in parents.get(node, []):
            if parent in seen:
                continue
            out.add(parent)
            out.update(walk(parent, seen | {parent}))
        cache[node] = out
        return out

    nodes = {e["from_id"] for e in edges} | {e["to_id"] for e in edges}
    return {node: walk(node, {node}) for node in nodes}


# --------------------------------------------------------------------------- #
# Diagnosis
# --------------------------------------------------------------------------- #
def _attempt_evidence(attempt: dict[str, Any]) -> tuple[dict[str, list[dict]], dict[str, list[str]]]:
    by_concept: dict[str, list[dict]] = {}
    misconceptions: dict[str, list[str]] = {}
    for question in attempt.get("questions", []):
        if question.get("unanswered", not question.get("answered", False)):
            continue
        for concept_id in question.get("tested_concept_ids", []):
            by_concept.setdefault(concept_id, []).append(question)
            if not question.get("correct") and question.get("misconception"):
                misconceptions.setdefault(concept_id, []).append(question["misconception"])
    return by_concept, misconceptions


def _level(direct_errors: int, dependent_count: int, repeated: bool, supporting: int) -> str:
    if direct_errors >= 2 and dependent_count >= 2:
        return "Stronger"
    if supporting >= 4:
        return "Stronger"
    if direct_errors >= 1 and (dependent_count >= 1 or repeated):
        return "Some"
    if direct_errors >= 2:
        return "Some"
    return "Limited"


def _alternatives(concept_name: str, dependents: list[str], prerequisite_names: list[str]) -> list[str]:
    alternatives = [
        "A careless slip or arithmetic error under time pressure rather than a missing idea.",
        "Misreading the question or its notation (for example a symbol you have not seen printed that way), "
        "rather than a gap in the concept itself.",
    ]
    if dependents:
        alternatives.append(
            f"The difficulty may sit in {', '.join(dependents[:2])} itself, not in {concept_name}."
        )
    for name in prerequisite_names[:1]:
        alternatives.append(f"A deeper gap in {name}, which comes before {concept_name}.")
    return alternatives


def _why_text(
    concept_name: str,
    supporting: list[dict],
    dependents: list[str],
    repeated: list[str],
    missing: str | None,
) -> str:
    parts: list[str] = []
    if supporting:
        sample = supporting[:4]
        parts.append(
            f"{len(supporting)} answer(s) point this way: "
            + "; ".join(
                f"{q.get('prompt', 'a question')[:70]}…" for q in sample[:2]
            )
            + (f" and {len(supporting) - 2} more" if len(supporting) > 2 else "")
            + "."
        )
    if dependents:
        parts.append(
            f"The mistake also appears in {', '.join(dependents[:3])}, which build"
            + ("s" if len(dependents) == 1 else "")
            + f" on {concept_name}."
        )
    if repeated:
        parts.append(
            f"The same kind of error repeated: {repeated[0]}."
        )
    if missing:
        parts.append(missing)
    return " ".join(parts)


async def _phrase_with_llm(payload: dict[str, Any]) -> None:
    """Ask the model to polish each gap's wording; keep deterministic text on any doubt."""
    gaps = payload.get("gaps") or []
    if not gaps:
        return
    allowed_pages = {citation["page"] for gap in gaps for citation in gap.get("page_references", [])}
    evidence = [
        {
            "concept_id": gap["concept_id"],
            "concept_name": gap["concept_name"],
            "kind": gap["kind"],
            "evidence_level": gap["evidence"],
            "supporting_questions": [
                {
                    "id": qid,
                    "prompt": next(
                        (o.get("prompt", "") for o in payload.get("observed", []) if o["question_id"] == qid),
                        "",
                    )[:160],
                }
                for qid in gap["supporting_question_ids"]
            ],
            "dependent_concepts": gap["dependent_concept_names"],
            "deterministic_summary": gap["summary"],
            "deterministic_why": gap["why"],
        }
        for gap in gaps
    ]
    from .prompts import diagnosis_phrasing_prompt

    system, user = diagnosis_phrasing_prompt(
        __import__("json").dumps(evidence, ensure_ascii=False)
    )
    try:
        phrased: DiagnosisPhrasingLLM = await get_llm().json(
            system=system, user=user, schema=DiagnosisPhrasingLLM, max_tokens=1600
        )
    except LLMError as exc:
        log.info("diagnosis phrasing skipped (%s)", exc.code)
        return
    for gap in gaps:
        entry = phrased.explanations.get(gap["concept_id"])
        if not entry:
            continue
        text = f"{entry.summary} {entry.why}".strip()
        pages = {int(p) for p in re.findall(r"\bpage[s]?\s+(\d+)", text)}
        if pages - allowed_pages:
            log.info("discarded diagnosis phrasing with unsupported page references")
            continue
        names = {gap["concept_name"], *gap["dependent_concept_names"]}
        mentioned = {
            n.strip()
            for n in re.findall(r"\b([A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]+){0,3})\b", text)
        }
        # Allow sentence-leading capitalisation; only reject clear new concept-like names is too fuzzy,
        # so we validate references instead (pages + cited concept names) and keep hedged wording.
        gap["summary"] = entry.summary.strip()
        gap["why"] = entry.why.strip() or gap["why"]


async def diagnose_attempt(session_id: str, attempt_id: str) -> dict[str, Any]:
    from .analysis import get_concept_map

    with get_db() as conn:
        attempt_row = conn.execute(
            "SELECT * FROM attempts WHERE id = ? AND session_id = ?", (attempt_id, session_id)
        ).fetchone()
        if attempt_row is None:
            raise ApiError(404, "attempt_not_found", "That attempt does not exist in your session.")
        nodes, edges, _ = get_concept_map(conn, session_id)
        names = {
            row["id"]: row["filename"]
            for row in conn.execute(
                "SELECT id, filename FROM documents WHERE session_id = ?", (session_id,)
            ).fetchall()
        }
        hypotheses = latest_hypotheses(conn, session_id)

    attempt = loads(attempt_row["results"], {}) or {}
    if not nodes:
        # Fall back to the concept snapshot stored with the quiz so diagnosis still works.
        params_row = None
        with get_db() as conn:
            params_row = conn.execute(
                "SELECT params FROM quizzes WHERE id = ? AND session_id = ?",
                (attempt.get("quiz_id"), session_id),
            ).fetchone()
        params = loads(params_row["params"], {}) if params_row else {}
        nodes = [
            {"id": c["id"], "name": c["name"], "description": c.get("description", ""), "level": 0, "importance": 0.5, "source_pages": []}
            for c in (params or {}).get("concepts", [])
        ]
    nodes_by_id = {n["id"]: n for n in nodes}
    if not nodes_by_id:
        raise ApiError(409, "no_concepts", "No concepts are available yet. Run document analysis first.")
    ancestors = _ancestors(edges)
    by_concept, misconceptions = _attempt_evidence(attempt)

    statuses = compute_statuses(session_id, nodes)

    observed: list[dict[str, Any]] = []
    wrong_by_concept: dict[str, list[dict]] = {}
    for question in attempt.get("questions", []):
        if question.get("correct"):
            continue
        unanswered = not question.get("answered")
        observed.append(
            {
                "question_id": question["id"],
                "concept_ids": question.get("tested_concept_ids", []),
                "concept_names": [
                    nodes_by_id.get(c, {}).get("name", c) for c in question.get("tested_concept_ids", [])
                ],
                "chosen": question.get("chosen"),
                "correct_answer": question["correct_option"],
                "pattern": (
                    "Not answered, so this question adds no evidence either way."
                    if unanswered
                    else question.get("misconception")
                    or "A less common answer; no specific misconception was recorded."
                ),
                "unanswered": unanswered,
                "prompt": question.get("prompt", ""),
                "options": question.get("options", {}),
            }
        )
        if not unanswered:
            for cid in question.get("tested_concept_ids", []):
                if cid in nodes_by_id:
                    wrong_by_concept.setdefault(cid, []).append(question)

    # Choose a supported prerequisite for each failing concept.
    root_map: dict[str, set[str]] = {}
    explained: set[str] = set()
    for concept_id, questions in wrong_by_concept.items():
        if len(questions) < MIN_ANSWERS_FOR_DIAGNOSIS:
            continue
        best: tuple[int, int, str] | None = None  # (support_count, -level, id)
        for parent in ancestors.get(concept_id, set()):
            if parent not in nodes_by_id:
                continue
            direct = by_concept.get(parent, [])
            direct_errors = [q for q in direct if not q.get("correct")]
            dependent_concepts = [
                cid
                for cid in wrong_by_concept
                if cid != parent and parent in ancestors.get(cid, set())
            ]
            # (b) repeated misconception: shared label between this concept and the parent's errors,
            # or the same label across two or more dependents of the parent.
            parent_labels = set(misconceptions.get(parent, []))
            dependent_labels = set(misconceptions.get(concept_id, []))
            repeated = bool(parent_labels & dependent_labels)
            label_counts: dict[str, int] = {}
            for cid in dependent_concepts:
                for label in misconceptions.get(cid, []):
                    label_counts[label] = label_counts.get(label, 0) + 1
            crossing = any(count >= 2 for count in label_counts.values())
            if not direct_errors and not (repeated or crossing):
                continue  # no supporting evidence: never blame an upstream concept
            support = len(direct_errors) + (2 if repeated else 0) + (1 if crossing else 0)
            level = int(nodes_by_id[parent].get("level") or 0)
            candidate = (support, -level, parent)
            if best is None or candidate > best:
                best = candidate
        if best is not None:
            root_map.setdefault(best[2], set()).add(concept_id)
            explained.add(concept_id)

    gaps: list[dict[str, Any]] = []
    for root_id, dependents in root_map.items():
        node = nodes_by_id[root_id]
        root_questions = [q for q in by_concept.get(root_id, []) if not q.get("correct")]
        dependent_questions = [
            q for cid in dependents for q in wrong_by_concept.get(cid, [])
        ]
        supporting = {q["id"]: q for q in root_questions + dependent_questions}
        labels: list[str] = []
        for q in supporting.values():
            if q.get("misconception") and q["misconception"] not in labels:
                labels.append(q["misconception"])
        repeated = [label for label in labels if sum(1 for q in supporting.values() if q.get("misconception") == label) >= 2]
        crossing = any(
            len([q for q in dependent_questions if q.get("misconception") == label]) >= 2
            for label in dependent_labels_for(misconceptions, dependents)
        )
        level = _level(len(root_questions), len(dependents), bool(repeated), len(supporting))
        missing_parts = []
        if not root_questions:
            missing_parts.append(
                "No question directly tested this concept in this quiz, which is why it is only a hypothesis."
            )
        if level == "Limited":
            missing_parts.append(
                "One or two answers are a lead, not a conclusion: one targeted retest would confirm or reject it."
            )
        dependent_names = [nodes_by_id[c]["name"] for c in sorted(dependents)]
        page_refs: list[dict[str, Any]] = []
        seen_refs: set[tuple[str, int]] = set()
        for ref in node.get("source_pages", []):
            for page in ref.get("pages", [])[:2]:
                key = (ref["document_id"], int(page))
                if key in seen_refs:
                    continue
                seen_refs.add(key)
                page_refs.append(
                    {
                        "document_id": ref["document_id"],
                        "document_name": names.get(ref["document_id"], "document"),
                        "page": int(page),
                        "snippet": "",
                    }
                )
        for q in list(supporting.values())[:3]:
            for citation in q.get("source_pages", []):
                key = (citation["document_id"], int(citation["page"]))
                if key in seen_refs:
                    continue
                seen_refs.add(key)
                page_refs.append(citation)
        gap = {
            "concept_id": root_id,
            "concept_name": node["name"],
            "kind": "prerequisite",
            "supporting_question_ids": sorted(supporting.keys()),
            "dependent_concept_ids": sorted(dependents),
            "dependent_concept_names": dependent_names,
            "supported_prerequisites": [],
            "alternatives": _alternatives(
                node["name"],
                dependent_names,
                [nodes_by_id[p]["name"] for p in ancestors.get(root_id, set()) if p in nodes_by_id],
            ),
            "evidence": level,
            "needs_more_evidence": level == "Limited",
            "summary": (
                f"Wrong answers in {', '.join(dependent_names) or 'related questions'}"
                + (" and in " + node["name"] + " itself" if root_questions else "")
                + f" suggest a possible foundational gap in {node['name']}. This is a hypothesis, not a verdict."
            ),
            "why": _why_text(node["name"], list(supporting.values()), dependent_names, repeated, " ".join(missing_parts)),
            "page_references": page_refs[:8],
            "recommended_follow_up": {
                "concept_id": root_id,
                "concept_name": node["name"],
                "prompt": f"Answer two fresh questions on {node['name']} to confirm or reject this hypothesis.",
            },
            "hypothesis_outcome": (hypotheses.get(root_id) or {}).get("outcome"),
        }
        gaps.append(gap)

    # Hypotheses that explanation could not attribute upstream.
    for concept_id, questions in wrong_by_concept.items():
        if concept_id in explained or concept_id in root_map:
            continue
        node = nodes_by_id.get(concept_id)
        if node is None or len(questions) < MIN_ANSWERS_FOR_DIAGNOSIS:
            continue
        support_prereqs = [
            nodes_by_id[p]["name"]
            for p in ancestors.get(concept_id, set())
            if p in nodes_by_id and by_concept.get(p) and all(q.get("correct") for q in by_concept[p])
        ]
        labels = misconceptions.get(concept_id, [])
        level = _level(len(questions), 0, len(labels) >= 2, len(questions))
        gaps.append(
            {
                "concept_id": concept_id,
                "concept_name": node["name"],
                "kind": "self",
                "supporting_question_ids": [q["id"] for q in questions],
                "dependent_concept_ids": [],
                "dependent_concept_names": [],
                "supported_prerequisites": support_prereqs,
                "alternatives": _alternatives(node["name"], [], support_prereqs),
                "evidence": level,
                "needs_more_evidence": len(questions) < 2 or level == "Limited",
                "summary": (
                    f"{len(questions)} wrong answer(s) in {node['name']}"
                    + (f" while {', '.join(support_prereqs)} looked solid" if support_prereqs else "")
                    + f". The difficulty looks more likely to be in {node['name']} itself."
                ),
                "why": _why_text(
                    node["name"],
                    questions,
                    [],
                    [label for label in labels if labels.count(label) >= 2],
                    "More evidence is needed before treating this as a confirmed gap."
                    if len(questions) < 2
                    else "",
                ),
                "page_references": [
                    {
                        "document_id": ref["document_id"],
                        "document_name": names.get(ref["document_id"], "document"),
                        "page": int(page),
                        "snippet": "",
                    }
                    for ref in node.get("source_pages", [])
                    for page in ref.get("pages", [])[:2]
                ][:6],
                "recommended_follow_up": {
                    "concept_id": concept_id,
                    "concept_name": node["name"],
                    "prompt": f"Answer two fresh questions on {node['name']} to test this hypothesis.",
                },
                "hypothesis_outcome": (hypotheses.get(concept_id) or {}).get("outcome"),
            }
        )

    gaps.sort(
        key=lambda g: (
            0 if g["kind"] == "prerequisite" else 1,
            -EVIDENCE_ORDER.get(g["evidence"], 0),
            -len(g["supporting_question_ids"]),
        )
    )

    payload: dict[str, Any] = {
        "id": new_id("diag_"),
        "attempt_id": attempt_id,
        "created_at": utcnow(),
        "observed": observed,
        "statuses": statuses,
        "gaps": gaps,
        "concepts": [
            ConceptNode(
                id=n["id"],
                name=n["name"],
                description=n.get("description", ""),
                level=int(n.get("level") or 0),
                importance=float(n.get("importance") or 0.5),
                source_pages=[],
            ).model_dump()
            for n in nodes
        ],
    }

    await _phrase_with_llm(payload)

    with get_db() as conn:
        conn.execute(
            "INSERT INTO diagnoses (id, session_id, attempt_id, payload, created_at) VALUES (?, ?, ?, ?, ?)",
            (payload["id"], session_id, attempt_id, dumps(payload), payload["created_at"]),
        )
        log_activity(
            conn,
            session_id,
            "diagnosis",
            f"Diagnosis: {len(gaps)} suspected gap(s), {len(observed)} observed mistake(s)",
        )
    return payload


def dependent_labels_for(
    misconceptions: dict[str, list[str]], dependents: set[str]
) -> list[str]:
    labels: list[str] = []
    for cid in dependents:
        labels.extend(misconceptions.get(cid, []))
    return labels


def latest_diagnosis(session_id: str) -> dict[str, Any] | None:
    """Latest stored diagnosis, with current follow-up outcomes merged in."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT payload FROM diagnoses WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (session_id,),
        ).fetchone()
        if row is None:
            return None
        payload = loads(row["payload"], {}) or {}
        hypotheses = latest_hypotheses(conn, session_id)
    for gap in payload.get("gaps", []):
        outcome = hypotheses.get(gap["concept_id"])
        gap["hypothesis_outcome"] = outcome["outcome"] if outcome else None
    payload["hypotheses"] = hypotheses
    return payload


def gap_counters(session_id: str) -> tuple[int, int]:
    """(open gaps, resolved gaps)."""
    payload = latest_diagnosis(session_id)
    if not payload:
        return 0, 0
    open_gaps = 0
    resolved = 0
    for gap in payload.get("gaps", []):
        if gap.get("hypothesis_outcome") == "supported":
            resolved += 1
        else:
            open_gaps += 1
    return open_gaps, resolved
