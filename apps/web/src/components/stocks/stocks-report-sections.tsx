import { AMBER_DAYS, fmtDays, MAX_LINES, RED_DAYS, TARGET_DAYS, WEIGHTS } from "@/lib/stocks";
import {
  Bullets,
  CONFIDENCE_RO,
  ReportSection,
  STATUS_RO,
  StatusText,
  Subhead,
  Table,
  num,
  pct,
  tonnes,
  type ReportData,
} from "./stocks-report-ui";

/** 2. Which ingredients run short, and by how much. */
export function ProblemSection({ data }: { data: ReportData }) {
  return (
    <ReportSection n={2} title="Problema">
      <p>{data.s.scenario.ro}</p>
      <Table
        head={["Ingredient", "Stoc", "Pe drum", "Consum lunar", "Acoperire (zile)", "Stare", `Deficit până la ${TARGET_DAYS} de zile`]}
        numeric={[1, 2, 3, 4, 6]}
        rows={data.rows.map((a) => [
          a.row.name.ro,
          tonnes(a.row.stock_t),
          tonnes(a.row.incoming_t),
          tonnes(a.row.monthly_use_t),
          num(Math.floor(a.cover_days)),
          <StatusText key="s" status={a.status} />,
          a.shortfall_t > 0 ? tonnes(a.shortfall_t) : "—",
        ])}
      />
      <p className="text-neutral-700">
        Zilele de acoperire arată cât durează stocul, plus livrările aflate pe drum, la consumul actual. Ținta este de{" "}
        {TARGET_DAYS} de zile; sub {AMBER_DAYS} de zile un ingredient intră în atenție, iar sub {RED_DAYS} de zile devine
        critic.
      </p>
    </ReportSection>
  );
}

/** 3. What to buy, where from, and what else to do. */
export function RecommendationsSection({ data }: { data: ReportData }) {
  return (
    <ReportSection newPage n={3} title="Recomandări">
      <p>
        Pentru fiecare ingredient critic sau în atenție: volumul de cumpărat până la ținta de {TARGET_DAYS} de zile,
        împărțit între cel mult {MAX_LINES} țări, în ordinea scorului. Calculul folosește capătul de jos al intervalului de
        prognoză, deci este conservator.
      </p>
      {data.facts.short.map((item) => {
        const notes = [
          item.uncovered_t > 0 && (
            <>
              <strong>Volum neacoperit: {tonnes(item.uncovered_t)}.</strong> Prognozele conservatoare nu ajung; acoperiți
              diferența cu ingrediente alternative sau prin ajustarea rețetelor.
            </>
          ),
          item.concentrated && (
            <>
              <strong>Concentrare:</strong> peste jumătate din volum vine dintr-o singură țară; negociați o sursă de
              rezervă.
            </>
          ),
          item.bridge_needed && (
            <>
              <strong>Achiziție-punte necesară:</strong> cel puțin o livrare ajunge după epuizarea stocului (~
              {fmtDays(item.cover_days, "ro")}); cumpărați o cantitate-punte de la un furnizor apropiat.
            </>
          ),
          item.alternatives.length > 0 ? (
            <>
              <strong>Alternative cu stoc suficient:</strong> {item.alternatives.join(", ")}.
            </>
          ) : (
            <>Nicio alternativă din aceeași grupă nu are stoc suficient pe această direcție.</>
          ),
        ].filter(Boolean);
        return (
          <div key={item.ingredient} className="break-inside-avoid">
            <Subhead>
              {item.ingredient} — {STATUS_RO[item.status].toLowerCase()}, {fmtDays(item.cover_days, "ro")} de acoperire,
              deficit {tonnes(item.shortfall_t)}
            </Subhead>
            <div className="mt-2 flex flex-col gap-2">
              {item.split.length > 0 ? (
                <Table
                  head={["Țara", "Volum", "Pondere", "Scor", "Livrare (zile)"]}
                  numeric={[1, 2, 3, 4]}
                  rows={item.split.map((l) => [l.country, tonnes(l.tonnes), pct(l.share_pct), num(l.score), num(l.lead_days)])}
                />
              ) : (
                <p>Nicio țară candidată nu are prognoză pentru acest ingredient.</p>
              )}
              <Bullets items={notes} />
            </div>
          </div>
        );
      })}
      <div className="break-inside-avoid">
        <Subhead>Opțiuni permanente</Subhead>
        <div className="mt-2">
          <Bullets
            items={[
              "Împărțiți achizițiile pe zone climatice diferite, ca o singură secetă să nu lovească toate sursele.",
              "Folosiți ingrediente alternative din aceeași grupă nutrițională atunci când stocul lor o permite.",
              "Contractați fermieri români care adoptă rotații mai bune (de exemplu cu mazăre, care fixează azotul); ecranul Furaje din aplicație arată riscul pe zone pentru culturile de furaje.",
            ]}
          />
        </div>
      </div>
    </ReportSection>
  );
}

/** 4. Ranked suppliers per short ingredient, with pros and cons for the top three. */
export function CandidatesSection({ data }: { data: ReportData }) {
  const w = (v: number) => pct(v * 100);
  return (
    <ReportSection n={4} title="Candidați furnizori">
      <p>
        Scorul (0–100) combină acoperirea deficitului ({w(WEIGHTS.coverage)}), fiabilitatea prognozei (
        {w(WEIGHTS.reliability)}), logistica ({w(WEIGHTS.logistics)}) și fricțiunea comercială ({w(WEIGHTS.friction)});
        formulele sunt în anexă. Volumele sunt intervale de prognoză ilustrative.
      </p>
      {data.short.map(({ a, candidates }) => (
        <div key={a.row.id} className="flex flex-col gap-2">
          <Subhead>{a.row.name.ro}</Subhead>
          <Table
            head={["Loc", "Țara", "Scor", "Volum estimat", "Încredere", "Livrare (zile)"]}
            numeric={[0, 2, 3, 5]}
            rows={candidates.slice(0, 5).map((c, i) => [
              i + 1,
              c.facts.name.ro,
              num(c.scores.total),
              `${num(c.forecast.volume_t.low)} – ${tonnes(c.forecast.volume_t.high)}`,
              CONFIDENCE_RO[c.forecast.confidence],
              num(c.facts.lead_days),
            ])}
          />
          <p className="mt-1 break-after-avoid text-[9pt] font-medium text-neutral-600">
            {a.row.name.ro}: avantajele și dezavantajele primilor trei candidați
          </p>
          <div className="grid grid-cols-1 gap-x-5 gap-y-3 text-[8.5pt] sm:grid-cols-3 print:grid-cols-3">
            {candidates.slice(0, 3).map((c, i) => (
              <div key={c.country} className="break-inside-avoid border-t border-neutral-400 pt-1.5">
                <p className="text-[9.5pt] font-semibold">
                  {i + 1}. {c.facts.name.ro} · scor {num(c.scores.total)}
                </p>
                <p className="mt-1.5 font-medium text-neutral-600">Avantaje</p>
                {c.pros.length > 0 ? <Bullets items={c.pros.map((p) => p.ro)} /> : <p>—</p>}
                <p className="mt-1.5 font-medium text-neutral-600">Dezavantaje</p>
                {c.cons.length > 0 ? <Bullets items={c.cons.map((p) => p.ro)} /> : <p>—</p>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </ReportSection>
  );
}
