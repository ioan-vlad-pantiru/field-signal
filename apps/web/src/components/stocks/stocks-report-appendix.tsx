import type { Confidence } from "@/lib/contracts";
import { AMBER_DAYS, CONF_SCORE, COUNTRIES, fmtDays, MAX_LINES, RED_DAYS, TARGET_DAYS, WEIGHTS, type CountryCode } from "@/lib/stocks";
import {
  Bullets,
  CONFIDENCE_RO,
  ReportSection,
  Subhead,
  Table,
  dateRo,
  num,
  pct,
  tonnes,
  yesNo,
  type ReportData,
} from "./stocks-report-ui";

/** Every country that appears in a recommended split, fastest first. */
function splitCountries(data: ReportData): CountryCode[] {
  const codes = new Set(data.short.flatMap((i) => i.allocation.lines.map((l) => l.country)));
  return [...codes].sort((x, y) => COUNTRIES[x].lead_days - COUNTRIES[y].lead_days);
}

/** 5. How the goods would travel from each recommended country. */
export function LogisticsSection({ data }: { data: ReportData }) {
  return (
    <ReportSection n={5} title="Logistică">
      <p>
        Țările din împărțirile recomandate. Timpii de livrare sunt estimări tipice până la fabricile din România, nu oferte
        ferme.
      </p>
      <Table
        head={["Țara", "Rută", "Livrare (zile)", "UE", "Schengen", "Cale ferată 1520 mm", "Dunăre", "Monedă"]}
        numeric={[2]}
        rows={splitCountries(data).map((code) => {
          const f = COUNTRIES[code];
          return [f.name.ro, f.route.ro, num(f.lead_days), yesNo(f.eu), yesNo(f.schengen), yesNo(f.gauge_1520), yesNo(f.danube), f.currency];
        })}
      />
    </ReportSection>
  );
}

interface Risk {
  title: string;
  action: string;
  affected: string[];
}

/** Deduplicated risks of the recommended splits, each with what it affects. */
function risks(data: ReportData): Risk[] {
  const lines = data.short.flatMap(({ a, allocation }) =>
    allocation.lines.map((l) => ({ a, l, f: COUNTRIES[l.country] })),
  );
  const names = (keep: (x: (typeof lines)[number]) => boolean, label = (x: (typeof lines)[number]) => x.f.name.ro) => [
    ...new Set(lines.filter(keep).map(label)),
  ];
  const list: Risk[] = [
    {
      title: "Livrare după epuizarea stocului",
      action: "Cumpărați o cantitate-punte de la un furnizor apropiat până sosește livrarea principală.",
      affected: names(
        (x) => x.f.lead_days > x.a.cover_days,
        (x) => `${x.a.row.name.ro}: ${x.f.name.ro} (~${fmtDays(x.f.lead_days, "ro")}; stoc ~${fmtDays(Math.floor(x.a.cover_days), "ro")})`,
      ),
    },
    {
      title: "Concentrare pe o singură țară",
      action: "Peste jumătate din volum depinde de o singură țară; negociați o sursă de rezervă.",
      affected: names(
        // Same rule as allocate(): more than half the shortfall, rounded up.
        (x) => x.l.tonnes > Math.ceil(x.a.shortfall_t / 2),
        (x) => `${x.a.row.name.ro}: ${x.f.name.ro} (${pct(x.l.share * 100)})`,
      ),
    },
    {
      title: "Volum neacoperit",
      action: "Prognozele conservatoare nu acoperă deficitul; folosiți ingrediente alternative sau ajustați rețetele.",
      affected: data.short
        .filter((i) => i.allocation.uncovered_t > 0)
        .map((i) => `${i.a.row.name.ro}: ${tonnes(i.allocation.uncovered_t)}`),
    },
    {
      title: "Secetă corelată",
      action: "Aceeași zonă climatică ca România: seceta care ne lovește le reduce și lor recolta. Nu bazați tot volumul pe aceste țări.",
      affected: names((x) => x.f.shared_drought),
    },
    {
      title: "Război și transport la Marea Neagră",
      action: "Contracte cu clauze de livrare și o sursă de rezervă pregătită.",
      affected: names((x) => x.f.war_risk),
    },
    {
      title: "Restricții la export",
      action: "Au restricționat exporturile în 2022; prevedeți în contract ce se întâmplă dacă restricțiile revin.",
      affected: names((x) => x.f.export_curbs_2022),
    },
    {
      title: "Soia modificată genetic și EUDR",
      action: "Cereți certificare non-MG și diligența EUDR privind defrișările.",
      affected: names((x) => x.a.row.id === "soy_meal" && x.f.gm_soy),
    },
    {
      title: "Expunere valutară",
      action: "Plăți în altă monedă decât euro: contracte în EUR sau acoperire valutară.",
      affected: names(
        (x) => x.f.currency !== "EUR",
        (x) => `${x.f.name.ro} (${x.f.currency})`,
      ),
    },
    ...splitCountries(data).flatMap((code) => {
      const note = COUNTRIES[code].note;
      return note ? [{ title: `Notă de țară: ${COUNTRIES[code].name.ro}`, action: note.ro, affected: [COUNTRIES[code].name.ro] }] : [];
    }),
  ];
  return list.filter((r) => r.affected.length > 0);
}

/** 6. What could go wrong with the recommendation. */
export function RisksSection({ data }: { data: ReportData }) {
  const list = risks(data);
  return (
    <ReportSection n={6} title="Riscuri și alte probleme">
      <p>Riscurile privesc țările din împărțirile recomandate. Fiecare apare o singură dată, cu tot ce afectează.</p>
      {list.length === 0 ? (
        <p>Nu au fost identificate riscuri pentru împărțirile recomandate.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {list.map((r, i) => (
            <li key={r.title} className="break-inside-avoid border-b border-neutral-300 pb-2.5">
              <p className="font-semibold">
                <span className="mr-2 text-neutral-500">{i + 1}.</span>
                {r.title}
              </p>
              <p className="mt-0.5">{r.action}</p>
              <p className="mt-0.5 text-[9pt] text-neutral-600">Afectează: {r.affected.join("; ")}</p>
            </li>
          ))}
        </ol>
      )}
    </ReportSection>
  );
}

/** Average half-width of the forecast interval per confidence level, as a share of the mid value. */
function intervalWidths(data: ReportData): { c: Confidence; pct: number }[] {
  return (["high", "medium", "low"] as const).flatMap((c) => {
    const fs = data.s.forecasts.filter((f) => f.confidence === c);
    if (fs.length === 0) return [];
    const sum = fs.reduce((acc, f) => acc + (f.volume_t.high - f.volume_t.low) / (2 * f.volume_t.mid), 0);
    return [{ c, pct: (100 * sum) / fs.length }];
  });
}

/** 7. Data, assumptions, confidence and the role of AI. */
export function AnnexSection({ data }: { data: ReportData }) {
  const years = data.s.forecasts.flatMap((f) => f.history.map((h) => h.year));
  const my = (y: number) => `${y}/${String(y + 1).slice(2)}`;
  const history = years.length > 0 ? `${my(Math.min(...years))} – ${my(Math.max(...years))}` : "—";
  const w = (v: number) => pct(v * 100);
  return (
    <ReportSection newPage n={7} title="Anexă — date, ipoteze, încredere, rolul AI">
      <Subhead>Starea datelor</Subhead>
      <Bullets
        items={[
          "Stocurile, consumul, livrările pe drum și prognozele furnizorilor sunt ilustrative (date demonstrative), construite după modelul secetei din vara lui 2024.",
          "Datele despre țări (UE, Schengen, monedă, rută, ecartament, Dunăre, restricții din 2022, soia MG, note) sunt fapte publice, valabile în noiembrie 2026.",
          `Data de referință: ${dateRo(data.s.as_of)}. An de comercializare: ${data.s.marketing_year}. Fereastra analizată: ${data.s.window.ro}. Istoricul prognozelor: anii de comercializare ${history}.`,
        ]}
      />
      <Subhead>Praguri</Subhead>
      <p>
        Critic: sub {RED_DAYS} de zile de acoperire. Atenție: sub {AMBER_DAYS} de zile. Ținta de aprovizionare: {TARGET_DAYS}{" "}
        de zile. Cel mult {MAX_LINES} țări furnizoare pe ingredient.
      </p>
      <Subhead>Ponderi și formule</Subhead>
      <div className="break-inside-avoid rounded-sm border border-neutral-300 px-3 py-2 font-mono text-[8.5pt] leading-relaxed">
        <p>consum zilnic = consum lunar / 30</p>
        <p>zile de acoperire = (stoc + pe drum) / consum zilnic</p>
        <p>deficit = max(0, {TARGET_DAYS} × consum zilnic − stoc − pe drum)</p>
        <p>acoperire = min(1, volum mediu prognozat / deficit) × 100</p>
        <p>fiabilitate = 50 % × scorul încrederii (ridicată {CONF_SCORE.high}, medie {CONF_SCORE.medium}, scăzută {CONF_SCORE.low}) + 50 % × îngustimea intervalului</p>
        <p>logistică = 100 × (1 − (zile de livrare − 2) / 48), limitat la 0–100</p>
        <p>fricțiune = 100 − 30 în afara UE − 30 risc de război − 10 ecartament 1520 mm − 15 restricții 2022 − 20 soia MG</p>
        <p>
          scor = {w(WEIGHTS.coverage)} acoperire + {w(WEIGHTS.reliability)} fiabilitate + {w(WEIGHTS.logistics)} logistică +{" "}
          {w(WEIGHTS.friction)} fricțiune
        </p>
        <p>
          alocare: primii {MAX_LINES} candidați; întâi cel mult jumătate din deficit fiecare, apoi completare până la capătul de
          jos al prognozei; restul rămâne neacoperit
        </p>
      </div>
      <Subhead>Ce înseamnă încrederea</Subhead>
      <p>
        Încrederea descrie lățimea intervalului de prognoză. În datele acestui raport, jumătatea intervalului este în medie:{" "}
        {intervalWidths(data)
          .map((x) => `${CONFIDENCE_RO[x.c]} ±${pct(x.pct)}`)
          .join(", ")}{" "}
        din valoarea mijlocie. Alocarea folosește capătul de jos al intervalului.
      </p>
      <Subhead>Ipoteze</Subhead>
      <Bullets
        items={[
          "Timpii de livrare sunt estimări tipice pe ruta indicată, nu oferte ferme.",
          "Faptele despre țări sunt valabile în noiembrie 2026 și trebuie verificate înainte de contractare.",
          "O lună are 30 de zile; consumul rămâne constant în fereastra analizată.",
          "Prețurile nu sunt luate în calcul.",
        ]}
      />
      <Subhead>Rolul AI și limitele lui</Subhead>
      <Bullets
        items={[
          "Un model lingvistic (Qwen) redactează doar paragraful din Rezumatul executiv, pornind de la cifrele deja calculate de reguli. Nu calculează nimic și nu este sursa niciunei cifre.",
          "Un filtru automat respinge textul dacă apare un număr (mai mare de 10) care nu există în cifrele calculate; atunci raportul păstrează rezumatul generat din reguli.",
          "Modelul poate reda greșit o nuanță (ordinea priorităților, tonul) sau poate omite un risc; rezumatul se citește împreună cu tabelele.",
        ]}
      />
      <Subhead>Pași următori</Subhead>
      <Bullets
        items={[
          "Înlocuirea stocurilor ilustrative cu un export din ERP-ul Transavia (stoc, consum, livrări pe drum).",
          "Prognoze de recoltă pentru regiunile furnizorilor din indicatori NASA — MODIS NDVI (vegetație), SMAP (umiditatea solului), IMERG (precipitații) — în locul prognozelor ilustrative.",
          "Timpi de livrare și prețuri din oferte reale ale furnizorilor.",
        ]}
      />
    </ReportSection>
  );
}
