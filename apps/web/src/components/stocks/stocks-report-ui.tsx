import type { ReactNode } from "react";
import type { Confidence } from "@/lib/contracts";
import { mockStocks } from "@/lib/mocks";
import {
  allocate,
  assessPath,
  buildBrief,
  rankCandidates,
  type Allocation,
  type BriefFacts,
  type Candidate,
  type CoverStatus,
  type PathId,
  type RowAssessment,
  type StocksScenario,
} from "@/lib/stocks";

/** One red or amber ingredient with its ranked suppliers and the conservative split. */
export interface ShortItem {
  a: RowAssessment;
  candidates: Candidate[];
  allocation: Allocation;
}

export interface ReportData {
  s: StocksScenario;
  path: PathId;
  rows: RowAssessment[];
  short: ShortItem[];
  facts: BriefFacts;
}

/** Everything the report shows, computed once per path from the illustrative fixture. */
export function buildReport(path: PathId): ReportData {
  const s = mockStocks;
  const rows = assessPath(s, path);
  const short = rows
    .filter((a) => a.status !== "ok")
    .map((a) => {
      const candidates = rankCandidates(s, a);
      return { a, candidates, allocation: allocate(candidates, a.shortfall_t) };
    });
  // Alternatives come from the brief facts, already named in Romanian.
  return { s, path, rows, short, facts: buildBrief(s, path, "ro") };
}

const NF = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 });
export const num = (v: number) => NF.format(Math.round(v));
export const tonnes = (v: number) => `${num(v)} t`;
export const pct = (v: number) => `${num(v)} %`;
export const yesNo = (v: boolean) => (v ? "Da" : "Nu");

export const STATUS_RO: Record<CoverStatus, string> = { red: "Critic", amber: "Atenție", ok: "Suficient" };
export const CONFIDENCE_RO: Record<Confidence, string> = { high: "ridicată", medium: "medie", low: "scăzută" };

const MONTHS = [
  "ianuarie", "februarie", "martie", "aprilie", "mai", "iunie",
  "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie",
];
/** "2026-11-15" → "15 noiembrie 2026", without `new Date()` in render. */
export function dateRo(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** A numbered report section; all but the first two start on a new printed page. */
export function ReportSection({
  n,
  title,
  newPage = false,
  children,
}: {
  n: number;
  title: string;
  newPage?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={newPage ? "mt-12 break-before-page print:mt-0" : "mt-9"}>
      <h2 className="mb-3 break-after-avoid border-b border-neutral-900 pb-1.5 text-[15pt] font-semibold tracking-tight">
        <span className="mr-2 text-neutral-500">{n}.</span>
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function Subhead({ children }: { children: ReactNode }) {
  return <h3 className="mt-3 break-after-avoid text-[11pt] font-semibold">{children}</h3>;
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-neutral-500">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** A plain ruled table; `numeric` lists the right-aligned column indexes. */
export function Table({
  head,
  rows,
  numeric = [],
}: {
  head: string[];
  rows: ReactNode[][];
  numeric?: number[];
}) {
  const align = (i: number) => (numeric.includes(i) ? "text-right" : "text-left");
  return (
    <table className="w-full border-collapse text-[9pt] leading-snug">
      <thead>
        <tr className="border-b border-neutral-900">
          {head.map((h, i) => (
            <th key={h} scope="col" className={`px-1.5 py-1 align-bottom font-semibold first:pl-0 ${align(i)}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, r) => (
          <tr key={r} className="break-inside-avoid border-b border-neutral-300">
            {cells.map((c, i) => (
              <td key={i} className={`px-1.5 py-1 align-top first:pl-0 ${align(i)}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Status in words (never colour alone); critical items in bold. */
export function StatusText({ status }: { status: CoverStatus }) {
  return <span className={status === "red" ? "font-semibold" : status === "ok" ? "text-neutral-500" : ""}>{STATUS_RO[status]}</span>;
}
