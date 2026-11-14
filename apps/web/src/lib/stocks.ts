import type { Confidence, Localized, Range, YearValue } from "./contracts.ts";

// Transavia stocks tab: cover days per ingredient, ranked supplier countries, a conservative
// purchase split and a management brief. Pure (no React, no JSON) so node:test can import it.

export type PathId = "A" | "B";
export type CountryCode = "HU" | "BG" | "RS" | "HR" | "SK" | "MD" | "UA" | "FR" | "PL" | "AR" | "BR";
export type CoverStatus = "red" | "amber" | "ok";

export interface StockRow {
  id: string;
  name: Localized;
  stock_t: number;
  monthly_use_t: number;
  incoming_t: number;
}

export interface SupplyForecast {
  ingredient: string;
  country: CountryCode;
  volume_t: Range;
  confidence: Confidence;
  history: YearValue[];
}

export interface StocksScenario {
  mock: true;
  as_of: string;
  marketing_year: string;
  window: Localized;
  scenario: Localized;
  paths: Record<PathId, { name: Localized; rows: StockRow[] }>;
  forecasts: SupplyForecast[];
}

export interface CountryFacts {
  name: Localized;
  eu: boolean;
  schengen: boolean;
  currency: string;
  route: Localized;
  lead_days: number;
  gauge_1520: boolean;
  danube: boolean;
  war_risk: boolean;
  shared_drought: boolean;
  export_curbs_2022: boolean;
  gm_soy: boolean;
  note: Localized | null;
}

export interface RowAssessment {
  row: StockRow;
  daily_t: number;
  cover_days: number;
  status: CoverStatus;
  shortfall_t: number;
}

export interface Candidate {
  country: CountryCode;
  facts: CountryFacts;
  forecast: SupplyForecast;
  scores: { coverage: number; reliability: number; logistics: number; friction: number; total: number };
  pros: Localized[];
  cons: Localized[];
}

export interface Allocation {
  lines: { country: CountryCode; tonnes: number; share: number }[];
  uncovered_t: number;
  concentrated: boolean;
}

export interface BriefFacts {
  mock: true;
  as_of: string;
  marketing_year: string;
  path: PathId;
  path_name: string;
  scenario: string;
  target_days: 90;
  n_red: number;
  n_amber: number;
  total_shortfall_t: number;
  n_countries: number;
  weights_pct: { coverage: 35; reliability: 25; logistics: 20; friction: 20 };
  short: {
    ingredient: string;
    status: "red" | "amber";
    cover_days: number;
    shortfall_t: number;
    split: { country: string; tonnes: number; share_pct: number; score: number; lead_days: number }[];
    uncovered_t: number;
    concentrated: boolean;
    bridge_needed: boolean;
    alternatives: string[];
  }[];
}

export const RED_DAYS = 30;
export const AMBER_DAYS = 60;
export const TARGET_DAYS = 90;
export const MAX_LINES = 4;
export const WEIGHTS = { coverage: 0.35, reliability: 0.25, logistics: 0.2, friction: 0.2 } as const;
export const CONF_SCORE: Record<Confidence, number> = { high: 90, medium: 65, low: 40 };

/** Ingredients that can stand in for each other (alternatives come from the same group). */
const GROUP: Record<string, string> = {
  maize: "cereals",
  wheat: "cereals",
  barley: "cereals",
  oats: "cereals",
  soy_meal: "protein",
  sunflower_meal: "protein",
  pea: "protein",
  chickpea: "protein",
  poultry_protein: "protein",
  sunflower_oil: "oil",
  flax: "fibre",
};

const SEA_ROUTE: Localized = {
  ro: "Maritim până la Constanța, apoi feroviar",
  en: "Sea freight to Constanța, then rail",
};

/** Public facts as of Nov 2026 (not mock). */
export const COUNTRIES: Record<CountryCode, CountryFacts> = {
  HU: {
    name: { ro: "Ungaria", en: "Hungary" },
    eu: true, schengen: true, currency: "HUF",
    route: { ro: "Rutier sau feroviar", en: "Road or rail" },
    lead_days: 3, gauge_1520: false, danube: true, war_risk: false,
    shared_drought: true, export_curbs_2022: true, gm_soy: false, note: null,
  },
  BG: {
    name: { ro: "Bulgaria", en: "Bulgaria" },
    eu: true, schengen: true, currency: "EUR",
    route: { ro: "Rutier, poduri peste Dunăre", en: "Road, over the Danube bridges" },
    lead_days: 3, gauge_1520: false, danube: true, war_risk: false,
    shared_drought: true, export_curbs_2022: false, gm_soy: false, note: null,
  },
  RS: {
    name: { ro: "Serbia", en: "Serbia" },
    eu: false, schengen: false, currency: "RSD",
    route: { ro: "Rutier, cu vamă", en: "Road, with customs" },
    lead_days: 5, gauge_1520: false, danube: true, war_risk: false,
    shared_drought: true, export_curbs_2022: true, gm_soy: false, note: null,
  },
  HR: {
    name: { ro: "Croația", en: "Croatia" },
    eu: true, schengen: true, currency: "EUR",
    route: { ro: "Rutier", en: "Road" },
    lead_days: 4, gauge_1520: false, danube: true, war_risk: false,
    shared_drought: true, export_curbs_2022: false, gm_soy: false, note: null,
  },
  SK: {
    name: { ro: "Slovacia", en: "Slovakia" },
    eu: true, schengen: true, currency: "EUR",
    route: { ro: "Rutier sau barjă pe Dunăre", en: "Road or Danube barge" },
    lead_days: 4, gauge_1520: false, danube: true, war_risk: false,
    shared_drought: false, export_curbs_2022: false, gm_soy: false, note: null,
  },
  MD: {
    name: { ro: "Republica Moldova", en: "Moldova" },
    eu: false, schengen: false, currency: "MDL",
    route: { ro: "Rutier sau feroviar, cu transbordare", en: "Road or rail, with transshipment" },
    lead_days: 5, gauge_1520: true, danube: true, war_risk: false,
    shared_drought: true, export_curbs_2022: true, gm_soy: false, note: null,
  },
  UA: {
    name: { ro: "Ucraina", en: "Ukraine" },
    eu: false, schengen: false, currency: "UAH",
    route: {
      ro: "Feroviar cu transbordare sau porturile dunărene Izmail/Reni",
      en: "Rail with transshipment, or the Danube ports of Izmail/Reni",
    },
    lead_days: 7, gauge_1520: true, danube: true, war_risk: true,
    shared_drought: true, export_curbs_2022: true, gm_soy: true,
    note: {
      ro: "Importurile din Ucraina intră sub contingentele tarifare UE (DCFTA) și sub licențele naționale de import ale României — verificați regimul în vigoare.",
      en: "Imports from Ukraine fall under EU tariff-rate quotas (DCFTA) and Romania's national import licences — check the regime in force.",
    },
  },
  FR: {
    name: { ro: "Franța", en: "France" },
    eu: true, schengen: true, currency: "EUR",
    route: { ro: "Feroviar sau rutier", en: "Rail or road" },
    lead_days: 8, gauge_1520: false, danube: false, war_risk: false,
    shared_drought: false, export_curbs_2022: false, gm_soy: false, note: null,
  },
  PL: {
    name: { ro: "Polonia", en: "Poland" },
    eu: true, schengen: true, currency: "PLN",
    route: { ro: "Rutier sau feroviar", en: "Road or rail" },
    lead_days: 5, gauge_1520: false, danube: false, war_risk: false,
    shared_drought: false, export_curbs_2022: false, gm_soy: false, note: null,
  },
  AR: {
    name: { ro: "Argentina", en: "Argentina" },
    eu: false, schengen: false, currency: "ARS",
    route: SEA_ROUTE,
    lead_days: 40, gauge_1520: false, danube: false, war_risk: false,
    shared_drought: false, export_curbs_2022: true, gm_soy: true,
    note: {
      ro: "Argentina aplică taxe la export; politica comercială e volatilă.",
      en: "Argentina levies export duties; its trade policy is volatile.",
    },
  },
  BR: {
    name: { ro: "Brazilia", en: "Brazil" },
    eu: false, schengen: false, currency: "BRL",
    route: SEA_ROUTE,
    lead_days: 35, gauge_1520: false, danube: false, war_risk: false,
    shared_drought: false, export_curbs_2022: false, gm_soy: true, note: null,
  },
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** "1 zi", "5 zile", "25 de zile" / "1 day", "5 days": Romanian puts "de" after numbers ending in 20–99 or 00. */
export function countLabel(n: number, lang: "ro" | "en", ro: [string, string], en: [string, string]): string {
  if (lang === "en") return `${n} ${n === 1 ? en[0] : en[1]}`;
  const de = n % 100 >= 20 || (n > 0 && n % 100 === 0) ? " de" : "";
  return `${n}${de} ${n === 1 ? ro[0] : ro[1]}`;
}
export const fmtDays = (n: number, lang: "ro" | "en") => countLabel(n, lang, ["zi", "zile"], ["day", "days"]);

export function assessRow(row: StockRow): RowAssessment {
  const daily_t = row.monthly_use_t / 30;
  const cover_days = daily_t > 0 ? (row.stock_t + row.incoming_t) / daily_t : Infinity;
  const status: CoverStatus = cover_days < RED_DAYS ? "red" : cover_days < AMBER_DAYS ? "amber" : "ok";
  const shortfall_t = Math.max(0, Math.round(TARGET_DAYS * daily_t - row.stock_t - row.incoming_t));
  return { row, daily_t, cover_days, status, shortfall_t };
}

/** Rows of one path, fewest cover days first. */
export function assessPath(s: StocksScenario, path: PathId): RowAssessment[] {
  return s.paths[path].rows.map(assessRow).sort((a, b) => a.cover_days - b.cover_days);
}

function candidate(forecast: SupplyForecast, a: RowAssessment): Candidate {
  const facts = COUNTRIES[forecast.country];
  const { low, mid, high } = forecast.volume_t;
  const n = facts.lead_days;
  const gmSoy = forecast.ingredient === "soy_meal" && facts.gm_soy;

  const coverage = a.shortfall_t === 0 ? 100 : Math.min(1, mid / a.shortfall_t) * 100;
  const reliability =
    0.5 * CONF_SCORE[forecast.confidence] + 0.5 * Math.max(0, 100 * (1 - (high - low) / (2 * mid)));
  const logistics = clamp(100 * (1 - (n - 2) / 48), 0, 100);
  const friction = clamp(
    100 -
      30 * Number(!facts.eu) -
      30 * Number(facts.war_risk) -
      10 * Number(facts.gauge_1520) -
      15 * Number(facts.export_curbs_2022) -
      20 * Number(gmSoy),
    0,
    100,
  );
  const total = Math.round(
    WEIGHTS.coverage * coverage +
      WEIGHTS.reliability * reliability +
      WEIGHTS.logistics * logistics +
      WEIGHTS.friction * friction,
  );

  const pros: Localized[] = [];
  if (facts.eu) pros.push({ ro: "Piață unică UE: fără vamă", en: "EU single market: no customs" });
  if (facts.eu && facts.schengen)
    pros.push({ ro: "Spațiul Schengen: fără controale la frontieră", en: "Schengen area: no border checks" });
  if (n <= 4) pros.push({ ro: `Livrare rapidă (~${fmtDays(n, "ro")})`, en: `Fast delivery (~${fmtDays(n, "en")})` });
  if (facts.danube)
    pros.push({ ro: "Alternativă de transport pe Dunăre", en: "Danube shipping as a transport alternative" });
  if (coverage >= 100)
    pros.push({ ro: "Volumul estimat acoperă singur deficitul", en: "The estimated volume alone covers the shortfall" });
  if (forecast.confidence === "high")
    pros.push({ ro: "Prognoză cu încredere ridicată", en: "High-confidence forecast" });
  if (!facts.shared_drought)
    pros.push({
      ro: "Altă zonă climatică: recolta nu depinde de aceeași secetă ca în România",
      en: "Different climate zone: the harvest does not depend on the same drought as Romania's",
    });

  const cons: Localized[] = [];
  if (!facts.eu)
    cons.push({
      ro: "În afara UE: formalități vamale și, pentru boabe, certificat fitosanitar",
      en: "Outside the EU: customs formalities and, for grain, a phytosanitary certificate",
    });
  if (facts.gauge_1520)
    cons.push({
      ro: "Ecartament feroviar 1520 mm: transbordare la frontieră",
      en: "1520 mm rail gauge: transshipment at the border",
    });
  if (facts.war_risk)
    cons.push({ ro: "Risc de război și de transport la Marea Neagră", en: "War and Black Sea shipping risk" });
  if (facts.shared_drought)
    cons.push({
      ro: "Aceeași zonă climatică: seceta care lovește România le reduce și lor recolta",
      en: "Same climate zone: the drought that hits Romania cuts their harvest too",
    });
  if (facts.export_curbs_2022)
    cons.push({ ro: "Precedent de restricții la export (2022)", en: "Precedent of export restrictions (2022)" });
  if (n >= 20)
    cons.push({
      ro: `Transport maritim lung (~${fmtDays(n, "ro")}), dependență de portul Constanța`,
      en: `Long sea voyage (~${fmtDays(n, "en")}), dependent on the port of Constanța`,
    });
  if (facts.currency !== "EUR")
    cons.push({
      ro: `Monedă non-euro (${facts.currency}): expunere valutară`,
      en: `Non-euro currency (${facts.currency}): exchange-rate exposure`,
    });
  if (forecast.confidence === "low" || (high - low) / mid > 0.6)
    cons.push({ ro: "Prognoză incertă: interval larg", en: "Uncertain forecast: wide interval" });
  if (gmSoy)
    cons.push({
      ro: "Soia modificată genetic frecventă: certificare non-MG și diligență EUDR privind defrișările",
      en: "Genetically modified soy is common: non-GM certification and EUDR deforestation due diligence",
    });
  if (facts.note) cons.push(facts.note);
  if (n > a.cover_days) {
    const m = Math.floor(a.cover_days);
    cons.push({
      ro: `Livrarea (~${fmtDays(n, "ro")}) ajunge după epuizarea stocului (~${fmtDays(m, "ro")}): necesită o achiziție-punte de la un furnizor apropiat`,
      en: `Delivery (~${fmtDays(n, "en")}) arrives after the stock runs out (~${fmtDays(m, "en")}): needs a bridge purchase from a nearby supplier`,
    });
  }

  return {
    country: forecast.country,
    facts,
    forecast,
    scores: { coverage, reliability, logistics, friction, total },
    pros,
    cons,
  };
}

/** Countries with a forecast for the row's ingredient, best total first (tie: shorter lead time). */
export function rankCandidates(s: StocksScenario, a: RowAssessment): Candidate[] {
  return s.forecasts
    .filter((f) => f.ingredient === a.row.id)
    .map((f) => candidate(f, a))
    .sort((x, y) => y.scores.total - x.scores.total || x.facts.lead_days - y.facts.lead_days);
}

/**
 * Conservative split over the top MAX_LINES candidates, using each forecast's low volume.
 * Pass 1 caps every country at half the shortfall (rounded up, so whole tonnes add up exactly);
 * pass 2 tops countries up to their low volume.
 */
export function allocate(candidates: Candidate[], shortfall_t: number): Allocation {
  const eligible = candidates.slice(0, MAX_LINES);
  const tonnes = eligible.map(() => 0);
  const half = Math.ceil(shortfall_t / 2);
  let remaining = shortfall_t;
  for (const cap of [half, Infinity]) {
    eligible.forEach((c, i) => {
      const take = Math.min(remaining, c.forecast.volume_t.low - tonnes[i], cap);
      tonnes[i] += take;
      remaining -= take;
    });
  }
  const lines = eligible
    .map((c, i) => ({ country: c.country, tonnes: tonnes[i], share: shortfall_t > 0 ? tonnes[i] / shortfall_t : 0 }))
    .filter((l) => l.tonnes > 0);
  return { lines, uncovered_t: remaining, concentrated: lines.some((l) => l.tonnes > half) };
}

/** For a red or amber row: same-path rows of the same ingredient group whose cover is ok. */
export function alternatives(s: StocksScenario, path: PathId, a: RowAssessment): RowAssessment[] {
  if (a.status === "ok") return [];
  const group = GROUP[a.row.id];
  return assessPath(s, path).filter((b) => b.status === "ok" && GROUP[b.row.id] === group);
}

export function buildBrief(s: StocksScenario, path: PathId, lang: "ro" | "en"): BriefFacts {
  const rows = assessPath(s, path);
  const countries = new Set<CountryCode>();
  const short = rows
    .filter((a) => a.status !== "ok")
    .map((a) => {
      const ranked = rankCandidates(s, a);
      const split = allocate(ranked, a.shortfall_t);
      const lines = split.lines.map((l) => {
        const c = ranked.find((r) => r.country === l.country)!;
        countries.add(l.country);
        return {
          country: c.facts.name[lang],
          tonnes: Math.round(l.tonnes),
          share_pct: Math.round(l.share * 100),
          score: c.scores.total,
          lead_days: c.facts.lead_days,
        };
      });
      return {
        ingredient: a.row.name[lang],
        status: a.status as "red" | "amber",
        cover_days: Math.floor(a.cover_days),
        shortfall_t: a.shortfall_t,
        split: lines,
        uncovered_t: Math.round(split.uncovered_t),
        concentrated: split.concentrated,
        bridge_needed: lines.some((l) => l.lead_days > a.cover_days),
        alternatives: alternatives(s, path, a).map((b) => b.row.name[lang]),
      };
    });
  return {
    mock: true,
    as_of: s.as_of,
    marketing_year: s.marketing_year,
    path,
    path_name: s.paths[path].name[lang],
    scenario: s.scenario[lang],
    target_days: TARGET_DAYS,
    n_red: rows.filter((a) => a.status === "red").length,
    n_amber: rows.filter((a) => a.status === "amber").length,
    total_shortfall_t: short.reduce((sum, x) => sum + x.shortfall_t, 0),
    n_countries: countries.size,
    weights_pct: { coverage: 35, reliability: 25, logistics: 20, friction: 20 },
    short,
  };
}

/** Deterministic executive summary built only from the facts (the fallback when no LLM answers). */
export function templateSummary(f: BriefFacts, lang: "ro" | "en"): string {
  const ro = lang === "ro";
  const num = (n: number) => new Intl.NumberFormat(ro ? "ro-RO" : "en-GB").format(n);
  const days = (n: number) => fmtDays(n, lang);
  const list = (items: string[]) =>
    items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${ro ? "și" : "and"} ${items.at(-1)}`;
  const lower = (s: string) => s.toLocaleLowerCase(lang);
  const countries = countLabel(f.n_countries, lang, ["țară", "țări"], ["country", "countries"]);
  const red = f.short.filter((x) => x.status === "red");
  const amber = f.short.filter((x) => x.status === "amber");
  const out: string[] = [
    ro
      ? `${f.path_name}, anul de comercializare ${f.marketing_year}, situația stocurilor la ${f.as_of}.`
      : `${f.path_name}, marketing year ${f.marketing_year}, stock position as of ${f.as_of}.`,
  ];
  if (red.length > 0) {
    const items = list(red.map((x) => `${lower(x.ingredient)} (~${days(x.cover_days)})`));
    out.push(ro ? `Stoc critic: ${items}.` : `Critical stock: ${items}.`);
  }
  if (amber.length > 0) {
    const items = list(amber.map((x) => lower(x.ingredient)));
    out.push(ro ? `În atenție: ${items}.` : `On watch: ${items}.`);
  }
  if (f.short.length === 0) {
    out.push(ro ? "Niciun ingredient nu are stocul sub pragul de atenție." : "No ingredient is below the watch threshold.");
  } else {
    out.push(
      ro
        ? `Pentru materiile prime critice și în atenție, refacerea a ${days(f.target_days)} de acoperire cere ${num(f.total_shortfall_t)} t, de la ${countries}.`
        : `For critical and watch items, restoring ${days(f.target_days)} of cover takes ${num(f.total_shortfall_t)} t from ${countries}.`,
    );
  }
  for (const x of f.short) {
    const split = list(x.split.map((l) => `${l.country} ${num(l.tonnes)} t`));
    let line = `${x.ingredient}: ${split || (ro ? "fără furnizor" : "no supplier")}`;
    if (x.uncovered_t > 0) {
      const alt = x.alternatives.length > 0 ? list(x.alternatives.map(lower)) : null;
      line += ro
        ? `; ${num(x.uncovered_t)} t rămân neacoperite${alt ? `, de înlocuit parțial cu ${alt}` : ""}`
        : `; ${num(x.uncovered_t)} t stay uncovered${alt ? `, partly replaceable with ${alt}` : ""}`;
    }
    out.push(`${line}.`);
  }
  const bridge = f.short.filter((x) => x.bridge_needed).map((x) => lower(x.ingredient));
  if (bridge.length > 0)
    out.push(
      ro
        ? `Pentru ${list(bridge)}, livrarea ajunge după epuizarea stocului: e nevoie de o achiziție-punte de la un furnizor apropiat.`
        : `For ${list(bridge)}, delivery arrives after the stock runs out: a bridge purchase from a nearby supplier is needed.`,
    );
  const concentrated = f.short.filter((x) => x.concentrated).map((x) => lower(x.ingredient));
  if (concentrated.length > 0)
    out.push(
      ro
        ? `La ${list(concentrated)}, o singură țară asigură peste jumătate din volum.`
        : `For ${list(concentrated)}, one country supplies over half the volume.`,
    );
  out.push(ro ? "Cifrele sunt ilustrative." : "Figures are illustrative.");
  return out.join(" ");
}
