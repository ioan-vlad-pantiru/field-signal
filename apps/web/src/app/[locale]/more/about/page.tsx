import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Section } from "@/components/ui/section";
import { SatelliteIcon } from "@/components/ui/icons";

const SOURCES = [
  { key: "power", dataset: "NASA POWER", resolution: "0.5° × 0.625°", period: "2001–2025", nasa: true },
  { key: "modis", dataset: "MODIS MOD13Q1", resolution: "250 m", period: "2001–2025", nasa: true },
  { key: "smap", dataset: "SMAP L4", resolution: "9 km", period: "2015–2025", nasa: true },
  { key: "soilgrids", dataset: "SoilGrids 2.0", resolution: "250 m", period: "—", nasa: false },
  { key: "eucropmap", dataset: "EUCROPMAP", resolution: "10 m", period: "2018", nasa: false },
  { key: "ins", dataset: "INS AGR110A", resolution: "—", period: "2001–2025", nasa: false },
] as const;

const WHAT = ["farmer", "buyer", "transparency"] as const;
const LIMITS = ["hail", "pests", "markets", "management", "scale"] as const;

export async function generateMetadata({ params }: PageProps<"/[locale]/more/about">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "About" });
  return { title: t("title") };
}

export default async function AboutPage({ params }: PageProps<"/[locale]/more/about">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("About");

  return (
    <article className="max-w-[720px]">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="mt-4 text-lg">{t("intro")}</p>
        <p className="mt-6 font-display text-xl font-semibold leading-snug">{t("judgment")}</p>
        <p className="mt-2 text-ink-muted">{t("judgmentDetail")}</p>
      </header>

      <Section title={t("whatTitle")}>
        <dl className="flex flex-col gap-5">
          {WHAT.map((key) => (
            <div key={key}>
              <dt className="font-semibold">{t(`whatCards.${key}`)}</dt>
              <dd className="mt-1">{t(`what.${key}`)}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title={t("sourcesTitle")} hint={t("sourcesHint")}>
        {/* Phones drop the resolution and period columns and show them under each use instead. */}
        <table className="w-full border-collapse text-left">
          <thead className="text-sm text-ink-muted">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-4 font-medium">{t("table.dataset")}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{t("table.use")}</th>
              <th scope="col" className="hidden py-2 pr-4 font-medium sm:table-cell">{t("table.resolution")}</th>
              <th scope="col" className="hidden py-2 font-medium sm:table-cell">{t("table.period")}</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => (
              <tr key={s.key} className="border-b border-line align-top">
                <th scope="row" className="py-3 pr-4 font-semibold">
                  <span className="sm:whitespace-nowrap">{s.dataset}</span>
                  {s.nasa ? (
                    <span className="mt-1 flex w-fit items-center gap-1 text-sm font-normal text-signal">
                      <SatelliteIcon size={14} />
                      {t("table.nasaData")}
                    </span>
                  ) : (
                    <span className="mt-1 block text-sm font-normal text-ink-muted">{t("table.otherData")}</span>
                  )}
                </th>
                <td className="py-3 pr-4">
                  {t(`sources.${s.key}`)}
                  <span className="mt-1 block text-sm tabular-nums text-ink-muted sm:hidden">
                    {s.resolution} · {s.period}
                  </span>
                </td>
                <td className="hidden whitespace-nowrap py-3 pr-4 tabular-nums sm:table-cell">{s.resolution}</td>
                <td className="hidden whitespace-nowrap py-3 tabular-nums sm:table-cell">{s.period}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-sm text-ink-muted">{t("nasaNote")}</p>
      </Section>

      <Section title={t("aiTitle")} hint={t("aiHint")}>
        <dl className="flex flex-col gap-5">
          <div>
            <dt className="font-semibold">{t("ai.modelTitle")}</dt>
            <dd className="mt-1">{t("ai.model")}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t("ai.textTitle")}</dt>
            <dd className="mt-1">{t("ai.text")}</dd>
          </div>
        </dl>
      </Section>

      <Section title={t("limitsTitle")}>
        <ul className="list-disc space-y-2 pl-5">
          {LIMITS.map((key) => (
            <li key={key}>{t(`limits.${key}`)}</li>
          ))}
        </ul>
      </Section>

      <Section title={t("demoTitle")}>
        <p>{t("demo")}</p>
      </Section>
    </article>
  );
}
