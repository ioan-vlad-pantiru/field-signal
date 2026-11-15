"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

type Mermaid = (typeof import("mermaid"))["default"];

/**
 * Paints the diagram with the design tokens. The SVG sits inline in the page, so the variables
 * resolve there and the diagram follows the light and dark themes without being drawn again.
 * `accent` is the class a chart gives the node it is about (`class model accent`).
 */
const THEME_CSS = `
  .node rect, .node polygon, .node path, .node circle { fill: var(--surface-sunken) !important; stroke: var(--line) !important; stroke-width: 1px; filter: none !important; }
  .node.accent rect, .node.accent polygon, .node.accent path { fill: var(--field-soft) !important; stroke: var(--field) !important; }
  .node .label, .nodeLabel, .nodeLabel p { color: var(--ink); fill: var(--ink); }
  .node.accent .nodeLabel, .node.accent .nodeLabel p { color: var(--field-strong); font-weight: 600; }
  .edgeLabel, .edgeLabel p, .edgeLabel span { color: var(--ink-muted); fill: var(--ink-muted); background-color: var(--surface); }
  .labelBkg { background-color: var(--surface); }
  .edgeLabel rect { fill: var(--surface); opacity: 1; }
  .flowchart-link, .edgePath .path { stroke: var(--ink-muted); stroke-width: 1.5px; }
  .marker, .arrowheadPath, .arrowMarkerPath { fill: var(--ink-muted); stroke: var(--ink-muted); }
`;

let loading: Promise<Mermaid> | null = null;

/** Loads Mermaid once, on first use: it is large, and most visits never open a diagram. */
function loadMermaid(): Promise<Mermaid> {
  loading ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      look: "classic",
      themeVariables: { fontFamily: getComputedStyle(document.body).fontFamily, fontSize: "15px" },
      themeCSS: THEME_CSS,
      flowchart: { htmlLabels: true, useMaxWidth: true, curve: "basis", padding: 8, nodeSpacing: 16, rankSpacing: 32, wrappingWidth: 120 },
    });
    return mermaid;
  });
  return loading;
}

type State = { status: "waiting" } | { status: "ready"; svg: string } | { status: "failed" };

/**
 * A Mermaid chart, drawn in the browser the first time it scrolls into view (so one inside a
 * closed `<details>` waits until that is opened). `caption` is shown under the chart and is also
 * its text alternative; if the chart cannot be drawn, the caption alone remains.
 */
export function Diagram({ chart, caption }: { chart: string; caption: string }) {
  const id = `diagram-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<State>({ status: "waiting" });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;

    async function draw() {
      try {
        const mermaid = await loadMermaid();
        // Labels are measured when the chart is laid out, so the web font has to be there first.
        await document.fonts.ready;
        const { svg } = await mermaid.render(id, chart);
        if (!cancelled) setState({ status: "ready", svg });
      } catch {
        // Mermaid leaves its error drawing in the page when a chart does not parse.
        document.getElementById(`d${id}`)?.remove();
        if (!cancelled) setState({ status: "failed" });
      }
    }

    if (!("IntersectionObserver" in window)) {
      void draw();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void draw();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [chart, id]);

  return (
    <figure ref={ref} className="flex flex-col gap-2">
      {state.status === "ready" ? (
        <div
          role="img"
          aria-label={caption}
          className="overflow-hidden rounded-md bg-surface p-1 [&_svg]:mx-auto [&_svg]:h-auto"
          // Drawn by Mermaid (strict mode, sanitized) from chart text this app wrote itself.
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      ) : state.status === "waiting" ? (
        <Skeleton className="h-48" />
      ) : null}
      <figcaption className="text-center text-sm text-ink-muted">{caption}</figcaption>
    </figure>
  );
}
