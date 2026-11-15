"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getStocksBrief } from "@/lib/api";
import { AMBER_DAYS, RED_DAYS, templateSummary, type PathId } from "@/lib/stocks";
import { Button, buttonClass } from "@/components/ui/button";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { LogisticsSection, RisksSection } from "./stocks-report-appendix";
import { CandidatesSection, ProblemSection, RecommendationsSection } from "./stocks-report-sections";
import { ReportSection, buildReport, dateRo, num, tonnes } from "./stocks-report-ui";

const FOOTER =
  "Prototip Field Signal · creat la NASA Space Apps Challenge 2026 · nu este un document Transavia · date ilustrative";

/**
 * On paper: the site chrome goes, the report fills an A4 sheet, a faint watermark repeats on every
 * page (fixed elements print on each page) and the disclaimer sits in the page margin, where it
 * cannot overlap the text.
 */
const PRINT_CSS = `.report-watermark { display: none; }
@media print {
  body > :not(main) { display: none !important; }
  html, body { background: #fff !important; }
  main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
  .report-watermark {
    display: block; position: fixed; top: 50%; left: 50%; z-index: 50; pointer-events: none;
    transform: translate(-50%, -50%) rotate(-35deg); white-space: nowrap;
    font: 700 46pt/1 system-ui, sans-serif; letter-spacing: 0.06em; color: #000; opacity: 0.08;
  }
  @page {
    size: A4;
    margin: 16mm;
    @bottom-center { content: "${FOOTER}"; font: 8pt Helvetica, Arial, sans-serif; color: #555; }
    @top-right { content: "Pagina " counter(page) " din " counter(pages); font: 8pt Helvetica, Arial, sans-serif; color: #555; }
  }
}`;

/**
 * A Romanian management report on the stock shortfall of one feed path (?path=A|B), meant to be
 * printed or saved as PDF. The summary is written by rules at once and replaced by the LLM's text
 * only when the API returns one that passed its number guard.
 */
export function StocksReport() {
  const params = useSearchParams();
  const path: PathId = params.get("path") === "B" ? "B" : "A";
  const data = useMemo(() => buildReport(path), [path]);
  const [llm, setLlm] = useState<{ path: PathId; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    void getStocksBrief(data.facts, "ro").then((brief) => {
      if (live && brief) setLlm({ path, text: brief.text });
    });
    return () => {
      live = false;
    };
  }, [data, path]);

  const fromLlm = llm !== null && llm.path === path;
  const { s, facts } = data;
  const kpis = [
    { value: num(facts.n_red), label: `ingrediente critice (sub ${RED_DAYS} de zile)` },
    { value: num(facts.n_amber), label: `ingrediente în atenție (${RED_DAYS}–${AMBER_DAYS} de zile)` },
    { value: tonnes(facts.total_shortfall_t), label: `de cumpărat până la ținta de ${facts.target_days} de zile` },
    { value: num(facts.n_countries), label: "țări furnizoare propuse" },
  ];

  return (
    <div lang="ro" className="flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <div aria-hidden className="report-watermark">
        DATE DEMONSTRATIVE
      </div>

      <div className="no-print -ml-3 flex flex-wrap items-center gap-1">
        <Link href={{ pathname: "/buyers", query: { view: "stocks", path } }} className={buttonClass("quiet")}>
          <ArrowLeftIcon size={18} />
          Înapoi la stocuri
        </Link>
        <Button variant="secondary" onClick={() => window.print()}>
          Tipărește / salvează PDF
        </Button>
      </div>

      <article className="mx-auto w-full max-w-[210mm] border border-neutral-300 bg-white px-[14mm] py-[16mm] text-[10pt] leading-normal text-neutral-900 tabular-nums shadow-sm print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="border-b-2 border-neutral-900 pb-6">
          <p className="text-[8.5pt] font-medium uppercase tracking-[0.14em] text-neutral-500">
            Prototip Field Signal · date demonstrative
          </p>
          <h1 className="mt-3 text-[24pt] font-semibold leading-tight tracking-tight">
            Raport de aprovizionare cu ingrediente
          </h1>
          <p className="mt-1 text-[13pt] text-neutral-700">{s.paths[path].name.ro}</p>
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[9.5pt]">
            <dt className="text-neutral-500">Data</dt>
            <dd>{dateRo(s.as_of)}</dd>
            <dt className="text-neutral-500">An de comercializare</dt>
            <dd>{s.marketing_year}</dd>
            <dt className="text-neutral-500">Fereastra analizată</dt>
            <dd>{s.window.ro}</dd>
            <dt className="text-neutral-500">Pregătit pentru</dt>
            <dd>echipele de achiziții Transavia</dd>
            <dt className="text-neutral-500">Statut</dt>
            <dd className="font-semibold">Date demonstrative: toate volumele sunt ilustrative</dd>
          </dl>
        </header>

        <ReportSection n={1} title="Rezumat executiv">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 print:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className="border-t border-neutral-900 pt-2">
                <p className="text-[18pt] font-semibold leading-none">{k.value}</p>
                <p className="mt-1.5 text-[8.5pt] leading-snug text-neutral-600">{k.label}</p>
              </div>
            ))}
          </div>
          <p className="text-[10.5pt] leading-relaxed">{fromLlm ? llm.text : templateSummary(facts, "ro")}</p>
          <p className="text-[8.5pt] italic text-neutral-500">
            {fromLlm
              ? "Rezumat redactat de un model lingvistic (Qwen) din cifrele calculate; verificat automat să nu conțină alte numere."
              : "Rezumat generat automat din reguli."}
          </p>
        </ReportSection>

        <ProblemSection data={data} />
        <RecommendationsSection data={data} />
        <CandidatesSection data={data} />
        <LogisticsSection data={data} />
        <RisksSection data={data} />

        <p className="mt-10 border-t border-neutral-300 pt-2 text-[8pt] text-neutral-500 print:hidden">{FOOTER}</p>
      </article>
    </div>
  );
}
