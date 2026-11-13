import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, SectionTitle } from "@/components/ui/card";
import {
  BarnIcon,
  BookIcon,
  CrossIcon,
  FieldIcon,
  InfoIcon,
  SatelliteIcon,
  ShieldIcon,
} from "@/components/ui/icons";

const SOURCES = [
  { key: "power", dataset: "NASA POWER", resolution: "0.5° × 0.625°", period: "2001–2025", nasa: true },
  { key: "modis", dataset: "MODIS MOD13Q1", resolution: "250 m", period: "2001–2025", nasa: true },
  { key: "smap", dataset: "SMAP L4", resolution: "9 km", period: "2015–2025", nasa: true },
  { key: "soilgrids", dataset: "SoilGrids 2.0", resolution: "250 m", period: "—", nasa: false },
  { key: "eucropmap", dataset: "EUCROPMAP", resolution: "10 m", period: "2018", nasa: false },
  { key: "ins", dataset: "INS AGR110A", resolution: "—", period: "2001–2025", nasa: false },
] as const;

const WHAT = [
  { key: "farmer", Icon: FieldIcon },
  { key: "buyer", Icon: BarnIcon },
  { key: "transparency", Icon: BookIcon },
] as const;

const LIMITS = ["hail", "pests", "markets", "management", "scale"] as const;

/** Stagger index for the .rise animation. */
const at = (i: number) => ({ "--i": i }) as CSSProperties;

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
      <header className="rise" style={at(0)}>
        <p className="font-semibold text-field">{t("eyebrow")}</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="mt-3 text-lg text-ink">{t("intro")}</p>
      </header>

      <aside
        className="rise flex gap-3 rounded-[20px] border-2 border-field bg-field-tint p-4 sm:p-5"
        style={at(1)}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-field text-on-field">
          <ShieldIcon size={22} />
        </span>
        <div>
          <p className="font-display text-lg font-semibold leading-snug sm:text-xl">{t("judgment")}</p>
          <p className="mt-1">{t("judgmentDetail")}</p>
        </div>
      </aside>

      <SectionTitle>{t("whatTitle")}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        {WHAT.map(({ key, Icon }, i) => (
          <Card key={key} className="rise" style={at(i + 2)}>
            <span className="flex size-10 items-center justify-center rounded-xl bg-field-tint text-field">
              <Icon size={22} />
            </span>
            <h3 className="mt-3 font-display font-semibold">{t(`whatCards.${key}`)}</h3>
            <p className="mt-1">{t(`what.${key}`)}</p>
          </Card>
        ))}
      </div>

      <SectionTitle hint={t("sourcesHint")}>{t("sourcesTitle")}</SectionTitle>
      <div className="rise overflow-x-auto rounded-[20px] border border-line bg-surface shadow-1" style={at(5)}>
        <table className="w-full min-w-[34rem] text-left">
          <thead className="bg-surface-sunken text-sm text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">{t("table.dataset")}</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">{t("table.use")}</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">{t("table.resolution")}</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">{t("table.period")}</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => (
              <tr key={s.key} className="border-t border-line align-top">
                <th scope="row" className="px-4 py-3 font-semibold">
                  <span className="whitespace-nowrap">{s.dataset}</span>
                  {s.nasa ? (
                    <span className="mt-1 flex w-fit items-center gap-1 rounded-full bg-signal-tint px-2 py-0.5 text-xs font-medium text-signal">
                      <SatelliteIcon size={14} />
                      {t("table.nasaData")}
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs font-normal text-ink-muted">{t("table.otherData")}</span>
                  )}
                </th>
                <td className="px-4 py-3">{t(`sources.${s.key}`)}</td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-sm tabular-nums">{s.resolution}</td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-sm tabular-nums">{s.period}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex gap-2 text-sm text-ink-muted">
        <InfoIcon size={18} className="mt-0.5 shrink-0" />
        <span>{t("nasaNote")}</span>
      </p>

      <SectionTitle hint={t("aiHint")}>{t("aiTitle")}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="rise" style={at(6)}>
          <h3 className="font-display font-semibold">{t("ai.modelTitle")}</h3>
          <p className="mt-1">{t("ai.model")}</p>
        </Card>
        <Card className="rise" style={at(7)}>
          <h3 className="font-display font-semibold">{t("ai.textTitle")}</h3>
          <p className="mt-1">{t("ai.text")}</p>
        </Card>
      </div>

      <h3 className="mt-4 font-display text-lg font-semibold">{t("limitsTitle")}</h3>
      <ul className="grid gap-3 sm:grid-cols-2">
        {LIMITS.map((key, i) => (
          <li
            key={key}
            className="rise flex items-start gap-3 rounded-[20px] border border-line bg-surface p-4 shadow-1"
            style={at(i + 8)}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
              <CrossIcon size={16} />
            </span>
            <span>{t(`limits.${key}`)}</span>
          </li>
        ))}
      </ul>

      <SectionTitle>{t("demoTitle")}</SectionTitle>
      <Card className="bg-wheat-tint">
        <p>{t("demo")}</p>
      </Card>
    </article>
  );
}
