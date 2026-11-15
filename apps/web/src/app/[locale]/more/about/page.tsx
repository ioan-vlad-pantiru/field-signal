import type { Metadata } from "next";
import type { ComponentType, ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BookIcon, ChatIcon, ChevronDownIcon, InfoIcon, LeafIcon, SatelliteIcon, ShieldIcon } from "@/components/ui/icons";
import { ScreenHeader } from "@/components/ui/screen-header";
import { BackLink } from "@/components/more/back-link";

const SOURCES = [
  { key: "power", dataset: "NASA POWER", url: "https://power.larc.nasa.gov", resolution: "0.5° × 0.625°", period: "1981–2025", nasa: true },
  { key: "modis", dataset: "MODIS MOD13Q1 (Terra)", url: "https://lpdaac.usgs.gov/products/mod13q1v061/", resolution: "250 m", period: "2001–2025", nasa: true },
  { key: "myd13", dataset: "MODIS MYD13Q1 (Aqua)", url: "https://lpdaac.usgs.gov/products/myd13q1v061/", resolution: "250 m", period: "2002–2025", nasa: true },
  { key: "smap", dataset: "SMAP L4 SPL4SMGP v008", url: "https://nsidc.org/data/spl4smgp", resolution: "9 km", period: "2015–2025", nasa: true },
  { key: "eucropmap", dataset: "EUCROPMAP", url: "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/EUCROPMAP/", resolution: "10 m", period: "2018, 2022", nasa: false },
  { key: "ins", dataset: "INS TEMPO AGR108A, AGR109A, AGR110A", url: "http://statistici.insse.ro:8077/tempo-online/", resolution: "County", period: "1990–2025", nasa: false },
  { key: "soilgrids", dataset: "SoilGrids 2.0", url: "https://soilgrids.org", resolution: "250 m", period: null, nasa: false },
  { key: "gisco", dataset: "GISCO NUTS 2024, LAU 2024", url: "https://gisco-services.ec.europa.eu/distribution/v2/", resolution: null, period: "2024", nasa: false },
  { key: "et0", dataset: "FAO-56 ET0 (from POWER)", url: "https://www.fao.org/4/x0490e/x0490e00.htm", resolution: "0.5° × 0.625°", period: "1981–2025", nasa: false },
] as const;

/** Glossary ids, shared with the `Term` popovers on other screens (`Glossary.<id>.term|text`). */
const GLOSSARY = ["et", "ndvi", "soilMoisture", "waterBalance", "frost"] as const;
const LIMITS = ["hail", "pests", "markets", "management", "scale"] as const;

type Icon = ComponentType<{ size?: number; className?: string }>;

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

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <ScreenHeader back={<BackLink label={tMore("title")} />} title={t("title")} meta={t("lead")} />

      <div className="flex flex-col gap-3">
        <Topic icon={LeafIcon} title={t("how.title")}>
          <p>{t("how.text")}</p>
          <p className="text-ink-muted">{t("how.judgment")}</p>
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

        <Topic icon={ChatIcon} title={t("ai.title")}>
          <p>
            <span className="font-semibold">{t("ai.modelTitle")}. </span>
            {t("ai.model")}
          </p>
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
      </div>
    </div>
  );
}
