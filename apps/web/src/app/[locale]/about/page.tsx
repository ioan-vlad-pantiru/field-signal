import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, SectionTitle } from "@/components/ui/card";

const SOURCES = [
  { key: "power", dataset: "NASA POWER", resolution: "0.5° × 0.625°", period: "2001–2025", nasa: true },
  { key: "modis", dataset: "MODIS MOD13Q1", resolution: "250 m", period: "2001–2025", nasa: true },
  { key: "smap", dataset: "SMAP L4", resolution: "9 km", period: "2015–2025", nasa: true },
  { key: "soilgrids", dataset: "SoilGrids 2.0", resolution: "250 m", period: "—", nasa: false },
  { key: "eucropmap", dataset: "EUCROPMAP", resolution: "10 m", period: "2018", nasa: false },
  { key: "ins", dataset: "INS AGR110A", resolution: "—", period: "2001–2025", nasa: false },
] as const;

const LIMITS = ["hail", "pests", "markets", "management", "scale"] as const;

export async function generateMetadata({ params }: PageProps<"/[locale]/about">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "About" });
  return { title: t("title") };
}

export default async function AboutPage({ params }: PageProps<"/[locale]/about">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("About");

  return (
    <article className="flex max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-lg">{t("intro")}</p>
      </header>

      <Card className="border-2 border-primary bg-primary-soft">
        <p className="text-lg font-semibold">{t("judgment")}</p>
      </Card>

      <SectionTitle>{t("whatTitle")}</SectionTitle>
      <ul className="list-disc space-y-2 pl-5">
        <li>{t("what.farmer")}</li>
        <li>{t("what.buyer")}</li>
        <li>{t("what.transparency")}</li>
      </ul>

      <SectionTitle hint={t("sourcesHint")}>{t("sourcesTitle")}</SectionTitle>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[34rem] text-left">
          <thead className="bg-surface-muted text-sm">
            <tr>
              <th scope="col" className="px-3 py-2">{t("table.dataset")}</th>
              <th scope="col" className="px-3 py-2">{t("table.use")}</th>
              <th scope="col" className="px-3 py-2">{t("table.resolution")}</th>
              <th scope="col" className="px-3 py-2">{t("table.period")}</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => (
              <tr key={s.key} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 font-semibold">
                  {s.dataset}
                  <span className="block text-xs font-normal text-muted">
                    {s.nasa ? t("table.nasaData") : t("table.otherData")}
                  </span>
                </th>
                <td className="px-3 py-2">{t(`sources.${s.key}`)}</td>
                <td className="px-3 py-2 tabular-nums">{s.resolution}</td>
                <td className="px-3 py-2 tabular-nums">{s.period}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionTitle>{t("aiTitle")}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <h3 className="font-semibold">{t("ai.modelTitle")}</h3>
          <p className="mt-1">{t("ai.model")}</p>
        </Card>
        <Card>
          <h3 className="font-semibold">{t("ai.textTitle")}</h3>
          <p className="mt-1">{t("ai.text")}</p>
        </Card>
      </div>
      <h3 className="mt-2 font-semibold">{t("limitsTitle")}</h3>
      <ul className="list-disc space-y-2 pl-5">
        {LIMITS.map((key) => (
          <li key={key}>{t(`limits.${key}`)}</li>
        ))}
      </ul>

      <SectionTitle>{t("demoTitle")}</SectionTitle>
      <p>{t("demo")}</p>
    </article>
  );
}
