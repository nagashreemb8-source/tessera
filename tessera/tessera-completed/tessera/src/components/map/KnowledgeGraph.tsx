import { useMemo } from "react";
import { CONCEPTS, MAP_LAYOUT } from "@/data/concepts";
import { cn } from "@/lib/utils";
import type { Concept, Status } from "@/types";

const W = 158;
const H = 58;

interface GraphEdge {
  from: string;
  to: string;
}

/** Layered layout for arbitrary (backend) concept maps: prerequisites on the left. */
function buildLayout(concepts: Concept[], edges: GraphEdge[]) {
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
  }
  const memo = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return 0;
    const ps = parents.get(id) ?? [];
    const value =
      ps.length === 0 ? 0 : 1 + Math.max(...ps.map((p) => depth(p, new Set([...seen, id]))));
    memo.set(id, value);
    return value;
  };
  const groups = new Map<number, string[]>();
  for (const concept of concepts) {
    const level = depth(concept.id, new Set());
    groups.set(level, [...(groups.get(level) ?? []), concept.id]);
  }
  const layout: Record<string, { x: number; y: number }> = {};
  let maxPerLevel = 1;
  for (const [level, ids] of groups) {
    maxPerLevel = Math.max(maxPerLevel, ids.length);
    ids.forEach((id, index) => {
      layout[id] = {
        x: 100 + level * 200,
        y: 0.5 + index - (ids.length - 1) / 2,
      };
    });
  }
  const height = Math.max(420, maxPerLevel * 84 + 120);
  for (const key of Object.keys(layout)) {
    layout[key] = { x: layout[key]!.x, y: height / 2 + layout[key]!.y * 84 };
  }
  const maxLevel = Math.max(0, ...[...groups.keys()]);
  return { layout, width: Math.max(1000, 100 + maxLevel * 200 + W), height };
}

export function KnowledgeGraph({
  statuses,
  selected,
  investigating,
  onSelect,
  compact = false,
  className,
  concepts,
  edges,
  inferredEdges,
}: {
  statuses: Record<string, Status>;
  selected?: string | null;
  investigating?: string | null;
  onSelect?: (id: string) => void;
  compact?: boolean;
  className?: string;
  concepts?: Concept[] | undefined;
  edges?: GraphEdge[] | undefined;
  /** Edge keys ("from::to") that the backend marked as inferred hypotheses. */
  inferredEdges?: Set<string> | undefined;
}) {
  const interactive = !!onSelect;
  const nodes = concepts ?? CONCEPTS;
  const graphEdges = useMemo<GraphEdge[]>(
    () =>
      edges ??
      CONCEPTS.flatMap((concept) =>
        concept.prerequisites.map((prerequisite) => ({ from: prerequisite, to: concept.id })),
      ),
    [edges],
  );
  const computed = useMemo(
    () => (concepts ? buildLayout(concepts, graphEdges) : null),
    [concepts, graphEdges],
  );
  const layoutFor = (id: string) =>
    computed ? (computed.layout[id] ?? { x: 0, y: 0 }) : (MAP_LAYOUT[id] ?? { x: 0, y: 0 });
  const viewBox = computed ? `0 0 ${computed.width} ${computed.height}` : "0 0 1000 420";
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  return (
    <svg
      viewBox={viewBox}
      className={cn("h-auto w-full", className)}
      role={interactive ? "group" : "img"}
      aria-label="Concept dependency graph"
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground/60" />
        </marker>
        <marker
          id="arrow-hot"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="fill-primary" />
        </marker>
      </defs>
      {graphEdges.map((edge) => {
        const a = layoutFor(edge.from);
        const b = layoutFor(edge.to);
        if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) return null;
        const x1 = a.x + W / 2;
        const x2 = b.x - W / 2 - 4;
        const mx = (x1 + x2) / 2;
        const hot =
          (investigating && (edge.from === investigating || edge.to === investigating)) ||
          (selected && (edge.from === selected || edge.to === selected));
        const inferred = inferredEdges?.has(`${edge.from}::${edge.to}`);
        return (
          <path
            key={`${edge.from}-${edge.to}`}
            d={`M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`}
            fill="none"
            strokeWidth={hot ? 1.8 : inferred ? 1 : 1.2}
            strokeDasharray={inferred && !hot ? "4 3" : undefined}
            markerEnd={hot ? "url(#arrow-hot)" : "url(#arrow)"}
            className={cn(
              "transition-all duration-300",
              hot
                ? "stroke-primary animate-dash"
                : inferred
                  ? "stroke-muted-foreground/25"
                  : "stroke-muted-foreground/35",
            )}
          />
        );
      })}
      {nodes.map((concept) => {
        const { x, y } = layoutFor(concept.id);
        const status = statuses[concept.id] ?? "untested";
        const isSelected = selected === concept.id;
        const isInvestigating = investigating === concept.id;
        const label =
          concept.name.length > 17
            ? concept.name.replace("Probability ", "Prob. ").replace("Distributions", "Distrib.")
            : concept.name;
        return (
          <g
            key={concept.id}
            transform={`translate(${x - W / 2},${y - H / 2})`}
            className={cn("graph-node group outline-none", interactive && "cursor-pointer")}
            tabIndex={interactive ? 0 : undefined}
            role={interactive ? "button" : undefined}
            aria-pressed={interactive ? isSelected : undefined}
            aria-label={
              interactive
                ? `${concept.name}, ${status}${isInvestigating ? ", under investigation" : ""}`
                : undefined
            }
            onClick={() => onSelect?.(concept.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect?.(concept.id);
              }
            }}
          >
            {isInvestigating && (
              <rect
                x={-6}
                y={-6}
                width={W + 12}
                height={H + 12}
                rx={12}
                className="fill-primary/10 stroke-primary/50 animate-soft-pulse"
                strokeWidth={1}
              />
            )}
            <rect
              width={W}
              height={H}
              rx={8}
              strokeWidth={isSelected || isInvestigating ? 2 : 1}
              className={cn(
                "transition-all duration-200 group-focus-visible:stroke-primary group-hover:brightness-125",
                status === "mastered" && "fill-primary/10 stroke-primary/45",
                status === "developing" && "fill-developing/10 stroke-developing/60",
                status === "untested" && "fill-surface-2 stroke-muted-foreground/30",
                (isSelected || isInvestigating) && "stroke-primary",
              )}
              strokeDasharray={status === "untested" ? "4 4" : undefined}
            />
            <circle
              cx={16}
              cy={H / 2}
              r={4}
              className={cn(
                status === "mastered" && "fill-primary",
                status === "developing" && "fill-developing",
                status === "untested" && "fill-muted-foreground/60",
              )}
            />
            <text
              x={28}
              y={compact ? H / 2 + 5 : H / 2 - 2}
              className="fill-foreground"
              style={{ fontSize: compact ? 15 : 14, fontWeight: 500 }}
            >
              {label.length > 19 ? `${label.slice(0, 18)}…` : label}
            </text>
            {!compact && (
              <text
                x={28}
                y={H / 2 + 15}
                className="fill-muted-foreground"
                style={{ fontSize: 11 }}
              >
                {status === "untested" ? "not yet assessed" : status}
                {isInvestigating ? " · investigating" : ""}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function MapLegend() {
  const items = [
    { cls: "bg-primary/20 border-primary/60", label: "Mastered" },
    { cls: "bg-developing/20 border-developing/70", label: "Developing" },
    { cls: "bg-surface-2 border-muted-foreground/40 border-dashed", label: "Not yet assessed" },
    { cls: "border-primary glow-ring", label: "Under investigation" },
  ];
  return (
    <ul
      className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"
      aria-label="Legend"
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span className={cn("h-3 w-5 rounded-sm border", item.cls)} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
