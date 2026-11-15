import type { Metadata } from "next";
import type { ComponentType, ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  BookIcon,
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  GitHubIcon,
  InfoIcon,
  LeafIcon,
  RefreshIcon,
  SatelliteIcon,
  ShieldIcon,
  UserIcon,
} from "@/components/ui/icons";
import { Diagram } from "@/components/ui/diagram";
import { ScreenHeader } from "@/components/ui/screen-header";
import { BackLink } from "@/components/more/back-link";
import { REPO_URL } from "@/lib/site";

/** What the models and the parcel map are built on; the full list with licences is in the README. */
const SOURCES = [
  { key: "power", dataset: "NASA POWER", url: "https://power.larc.nasa.gov", resolution: "0.5° × 0.625°", period: "1984–2025", nasa: true },
  { key: "hls", dataset: "NASA HLS v2.0 (Landsat, Sentinel-2)", url: "https://doi.org/10.5067/HLS/HLSL30.002", resolution: "30 m", period: "2016–2024", nasa: true },
  { key: "smap", dataset: "SMAP L4 SPL4SMGP v008", url: "https://nsidc.org/data/spl4smgp", resolution: "9 km", period: "2016–2024", nasa: true },
  { key: "srtm", dataset: "NASA SRTM v003", url: "https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1.003", resolution: "30 m", period: null, nasa: true },
  { key: "soilgrids", dataset: "SoilGrids 2.0", url: "https://soilgrids.org", resolution: "250 m", period: null, nasa: false },
  { key: "dem", dataset: "Copernicus DEM GLO-30", url: "https://registry.opendata.aws/copernicus-dem/", resolution: "30 m", period: null, nasa: false },
  { key: "croptypes", dataset: "Copernicus HRL Crop Types", url: "https://land.copernicus.eu/en/products", resolution: "10 m", period: "2017–2024", nasa: false },
  { key: "apia", dataset: "APIA LPIS (AGI Online)", url: "https://data.gov.ro/dataset/parcele_agricole_agionline_apia", resolution: "Alba", period: "2025", nasa: false },
  { key: "eucropmap", dataset: "EUCROPMAP", url: "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/EUCROPMAP/", resolution: "10 m", period: "2018, 2022", nasa: false },
  { key: "eurostat", dataset: "Eurostat apro_cpshr", url: "https://ec.europa.eu/eurostat/databrowser/view/apro_cpshr/default/table", resolution: "NUTS 2", period: "2017–2024", nasa: false },
  { key: "gisco", dataset: "GISCO NUTS 2021, LAU 2024", url: "https://gisco-services.ec.europa.eu/distribution/v2/", resolution: null, period: null, nasa: false },
] as const;

/** Glossary ids, shared with the `Term` popovers on other screens (`Glossary.<id>.term|text`). */
const GLOSSARY = ["et", "ndvi", "soilMoisture", "waterBalance", "frost"] as const;
const LIMITS = ["hail", "pests", "markets", "management", "scale", "greenness"] as const;

/** What the project is built with. Product names are not translated; only the row labels are. */
const TOOLS = {
  web: "TypeScript, Next.js, React, Tailwind CSS, MapLibre GL, three.js",
  api: "Python, FastAPI, OR-Tools, PostgreSQL",
  models: "PyTorch, XGBoost, NumPy, Polars, Google Earth Engine",
  hosting: "Azure Container Apps, GitHub Actions",
} as const;

type Icon = ComponentType<{ size?: number; className?: string }>;

/** A Mermaid node label: quoted, so punctuation in a translation cannot break the chart. */
function label(text: string): string {
  return `"${text.replaceAll('"', "#quot;")}"`;
}

export async function generateMetadata({ params }: PageProps<"/[locale]/more/about">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "About" });
  return { title: t("title") };
}

/** One collapsible card: closed by default, so the page reads as a short list of topics. */
function Topic({ icon: Icon, title, children }: { icon: Icon; title: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg bg-surface shadow-1">
      <summary className="press flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-2 font-semibold [&::-webkit-details-marker]:hidden">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-field-soft text-field-strong">
          <Icon size={18} />
        </span>
        <span className="flex-1">{title}</span>
        <ChevronDownIcon size={18} className="shrink-0 text-ink-muted transition-transform duration-[var(--duration-base)] group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-5 pt-1">{children}</div>
    </details>
  );
}

export default async function AboutPage({ params }: PageProps<"/[locale]/more/about">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("About");
  const tg = await getTranslations("Glossary");
  const tMore = await getTranslations("More");
  const terms = GLOSSARY.filter((id) => tg.has(`${id}.term`) && tg.has(`${id}.text`));

  // Charts are top-down and two boxes wide at most, so they stay readable on a phone.
  const replayChart = `flowchart TD
    field[${label(t("diagrams.replay.field"))}] --> model
    weather[${label(t("diagrams.replay.weather"))}] --> model
    model([${label(t("diagrams.replay.model"))}]) --> states[${label(t("diagrams.replay.states"))}]
    states --> scores[${label(t("diagrams.replay.scores"))}]
    scores --> fit[${label(t("diagrams.replay.fit"))}]
    priorities[${label(t("diagrams.replay.priorities"))}] --> fit
    weather ~~~~~ priorities
    class model,fit accent`;
  const stepChart = `flowchart TD
    now[${label(t("diagrams.step.now"))}] --> model
    inputs[${label(t("diagrams.step.inputs"))}] --> model
    model([${label(t("diagrams.step.model"))}]) --> next[${label(t("diagrams.step.next"))}]
    next -.-> again[${label(t("diagrams.step.loop"))}]
    class model accent`;
  const outlookChart = `flowchart TD
    seasons[${label(t("diagrams.outlook.seasons"))}] --> greenness[${label(t("diagrams.outlook.greenness"))}]
    greenness --> yieldModel([${label(t("diagrams.outlook.yieldModel"))}])
    yieldModel --> tonnes[${label(t("diagrams.outlook.tonnes"))}]
    tonnes --> map[${label(t("diagrams.outlook.map"))}]
    class yieldModel accent`;
  // The invisible links put the four services in two rows of two instead of one row of four.
  const systemChart = `flowchart TD
    app[${label(t("diagrams.system.app"))}] --> api
    whatsapp[${label(t("diagrams.system.whatsapp"))}] --> api
    api([${label(t("diagrams.system.api"))}]) --> model[${label(t("diagrams.system.model"))}]
    api --> parcels[${label(t("diagrams.system.parcels"))}]
    model ~~~ accounts[${label(t("diagrams.system.accounts"))}]
    parcels ~~~ llm[${label(t("diagrams.system.llm"))}]
    api --> accounts
    api --> llm
    class api accent`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <ScreenHeader back={<BackLink label={tMore("title")} />} title={t("title")} meta={t("lead")} />

      <div className="flex flex-col gap-3">
        <Topic icon={LeafIcon} title={t("what.title")}>
          <p>{t("what.farmer")}</p>
          <p>{t("what.farm")}</p>
          <p>{t("what.buyers")}</p>
          <p className="text-ink-muted">{t("what.coverage")}</p>
        </Topic>

        <Topic icon={RefreshIcon} title={t("how.title")}>
          <p>{t("how.replay")}</p>
          <p>{t("how.model")}</p>
          <Diagram chart={replayChart} caption={t("diagrams.replay.caption")} />
          <p>{t("how.plan")}</p>
          <p className="text-ink-muted">{t("how.judgment")}</p>
        </Topic>

        <Topic icon={CheckIcon} title={t("tested.title")}>
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>{t("tested.training")}</li>
            <li>{t("tested.unseen")}</li>
            <li>{t("tested.swap")}</li>
            <li>{t("tested.yield")}</li>
          </ul>
        </Topic>

        <Topic icon={SatelliteIcon} title={t("sources.title")}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {SOURCES.map((s) => (
              <li key={s.key} className="rounded-md bg-surface-sunken p-3">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline decoration-line underline-offset-2 hover:text-field-strong">{s.dataset}</a>
                  <span
                    className={`rounded-pill px-2 text-xs font-semibold ${s.nasa ? "bg-field-soft text-field-strong" : "bg-surface text-ink-muted"}`}
                  >
                    {s.nasa ? t("sources.nasa") : t("sources.other")}
                  </span>
                </p>
                <p className="mt-1 text-sm">{t(`sources.${s.key}`)}</p>
                <p className="mt-1 text-xs tabular-nums text-ink-muted">
                  {[s.resolution, s.period].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-muted">{t("sources.note")}</p>
        </Topic>

        <Topic icon={ChatIcon} title={t("ai.title")}>
          <p>
            <span className="font-semibold">{t("ai.modelTitle")}. </span>
            {t("ai.model")}
          </p>
          <Diagram chart={stepChart} caption={t("diagrams.step.caption")} />
          <p>
            <span className="font-semibold">{t("ai.yieldTitle")}. </span>
            {t("ai.yield")}
          </p>
          <Diagram chart={outlookChart} caption={t("diagrams.outlook.caption")} />
          <p>
            <span className="font-semibold">{t("ai.textTitle")}. </span>
            {t("ai.text")}
          </p>
        </Topic>

        <Topic icon={ShieldIcon} title={t("limits.title")}>
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            {LIMITS.map((key) => (
              <li key={key}>{t(`limits.${key}`)}</li>
            ))}
          </ul>
        </Topic>

        <Topic icon={InfoIcon} title={t("demo.title")}>
          <p>{t("demo.text")}</p>
        </Topic>

        {/* The Glossary namespace is shared with the Term popovers; skip the section until it exists. */}
        {terms.length > 0 ? (
          <Topic icon={BookIcon} title={t("glossaryTitle")}>
            <dl className="flex flex-col gap-3">
              {terms.map((id) => (
                <div key={id} id={`term-${id}`} className="scroll-mt-24">
                  <dt className="font-semibold">{tg(`${id}.term`)}</dt>
                  <dd className="text-ink-muted">{tg(`${id}.text`)}</dd>
                </div>
              ))}
            </dl>
          </Topic>
        ) : null}

        <Topic icon={UserIcon} title={t("made.title")}>
          <p>{t("made.text")}</p>
          <p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-semibold underline decoration-line underline-offset-2 hover:text-field-strong"
            >
              <GitHubIcon size={18} />
              {t("made.code")}
            </a>
          </p>
          <Diagram chart={systemChart} caption={t("diagrams.system.caption")} />
          <div>
            <p className="font-semibold">{t("made.tools")}</p>
            <dl className="mt-2 flex flex-col gap-2 text-sm">
              <div>
                <dt className="text-ink-muted">{t("made.web")}</dt>
                <dd>{TOOLS.web}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">{t("made.api")}</dt>
                <dd>{TOOLS.api}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">{t("made.models")}</dt>
                <dd>{TOOLS.models}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">{t("made.hosting")}</dt>
                <dd>{TOOLS.hosting}</dd>
              </div>
            </dl>
          </div>
        </Topic>
      </div>
    </div>
  );
}
