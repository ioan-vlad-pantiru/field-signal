import Image from "next/image";
import type { ComponentType, ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Crop, Strategy } from "@/lib/contracts";
import { mockFieldAnalysis } from "@/lib/mocks";
import { buttonClass } from "@/components/ui/button";
import {
  BarnIcon,
  ChatIcon,
  CloudRainIcon,
  CrossIcon,
  DropIcon,
  FieldIcon,
  GridIcon,
  LayersIcon,
  LeafIcon,
  SatelliteIcon,
} from "@/components/ui/icons";
import { SeasonAxis, SeasonStrip } from "@/components/ui/season-strip";
import { HeroScene } from "@/components/home/hero-scene";

type Icon = ComponentType<{ size?: number; className?: string }>;

const STEPS = ["field", "rotation", "result"] as const;
const LOOK: [string, Icon][] = [
  ["weather", CloudRainIcon],
  ["plants", LeafIcon],
  ["water", DropIcon],
  ["soil", LayersIcon],
];
const GET: [string, Icon][] = [
  ["compare", GridIcon],
  ["alternatives", LeafIcon],
  ["plan", FieldIcon],
  ["ask", ChatIcon],
];
const LIMITS = ["hail", "pests", "markets", "management", "scale"] as const;
const SOURCE_COUNT = 6;

function count(strategy: Strategy, status: "bad" | "watch") {
  return strategy.replay.filter((o) => o.status === status).length;
}

/** A landing-page block: big heading, optional lead, generous space above. */
function Block({ title, lead, children }: { title: ReactNode; lead?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-20 sm:mt-28">
      <h2 className="max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {lead ? <p className="mt-3 max-w-2xl text-lg text-ink-muted">{lead}</p> : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

function IconCard({ icon: Icon, title, text }: { icon: Icon; title: string; text: string }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-field-tint text-field-strong">
        <Icon size={22} />
      </span>
      <h3 className="mt-4 text-lg font-semibold leading-snug">{title}</h3>
      <p className="mt-1 text-ink-muted">{text}</p>
    </li>
  );
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Home");
  const tCrops = await getTranslations("CropsShort");
  const tAbout = await getTranslations("About");
  const lang = locale === "en" ? "en" : "ro";

  // The example is the real component on the bundled demo field, so every number is computed.
  const demo = mockFieldAnalysis;
  const strategies = [...demo.strategies].sort((a, b) => count(a, "bad") - count(b, "bad") || b.score.total - a.score.total);
  const current = strategies.find((s) => s.is_current) ?? strategies[strategies.length - 1];
  const best = strategies[0];
  const years = Array.from({ length: demo.period_end - demo.period_start + 1 }, (_, i) => demo.period_start + i);
  const crops = (sequence: readonly Crop[]) => sequence.map((c) => tCrops(c).toLocaleLowerCase(lang)).join(", ");
  const stats = [
    { value: years.length, label: t("stats.seasons") },
    { value: SOURCE_COUNT, label: t("stats.sources") },
    { value: demo.strategies.length, label: t("stats.rotations") },
  ];

  return (
    <div>
      <section className="group relative isolate flex min-h-[78svh] flex-col justify-end overflow-hidden rounded-2xl bg-[#0b120e] sm:min-h-[680px]">
        <Image
          src="/hero-transylvania.webp"
          alt={t("imageAlt")}
          fill
          priority
          sizes="(min-width: 1200px) 1168px, 100vw"
          className="-z-10 object-cover"
        />
        <HeroScene sequence={best.sequence} firstYear={demo.period_end + 2} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/35 to-transparent sm:bg-gradient-to-tr sm:from-black/75 sm:via-black/20" />
        <div className="flex max-w-3xl flex-col gap-4 p-5 text-white sm:p-10">
          <h1 className="text-[2rem] font-semibold leading-[1.08] tracking-tight sm:text-[3.25rem]">{t("title")}</h1>
          <p className="max-w-xl text-lg text-white/90 sm:text-xl">{t("lead")}</p>
          <Link href="/field" className={buttonClass("primary", "lg", "mt-2 self-start")}>
            {t("start")}
          </Link>
          <p className="mt-2 text-xs text-white/70 group-has-[[data-scene=ready]]:hidden">{t("imageCredit")}</p>
          <p className="mt-2 hidden text-xs text-white/70 group-has-[[data-scene=ready]]:block">{t("sceneNote")}</p>
        </div>
      </section>


      <dl className="mt-4 grid gap-2 sm:mt-6 sm:grid-cols-3 sm:gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex flex-row-reverse items-center justify-end gap-4 rounded-2xl border border-line bg-surface px-4 py-3 sm:flex-col-reverse sm:items-start sm:gap-1 sm:p-6"
          >
            <dt className="text-ink-muted sm:text-base">{stat.label}</dt>
            <dd className="w-12 shrink-0 font-display text-3xl font-semibold tabular-nums text-field-strong sm:w-auto sm:text-5xl">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <Block title={t("whatTitle")}>
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start">
          <p className="text-xl leading-relaxed sm:text-2xl">{t("whatText")}</p>
          <p className="flex items-start gap-3 rounded-2xl bg-field-tint p-5 text-field-strong">
            <SatelliteIcon size={22} className="mt-0.5 shrink-0" />
            <span className="font-medium">{t("whatJudgment")}</span>
          </p>
        </div>
      </Block>

      <Block title={t("lookTitle")}>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LOOK.map(([key, icon]) => (
            <IconCard key={key} icon={icon} title={t(`look.${key}.title`)} text={t(`look.${key}.text`)} />
          ))}
        </ul>
      </Block>

      <Block
        title={t("proofTitle", { place: demo.location.commune ?? demo.location.label })}
        lead={t("proofSentence", {
          current: count(current, "bad"),
          currentCrops: crops(current.sequence),
          best: count(best, "bad"),
          bestCrops: crops(best.sequence),
        })}
      >
        <div className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5 sm:p-8">
          {[current, best].map((strategy) => {
            const name = strategy.is_current ? t("current") : strategy.name[lang];
            return (
              <div key={strategy.id}>
                <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{name}</span>
                  <span className="text-sm text-ink-muted">{crops(strategy.sequence)}</span>
                </p>
                <SeasonStrip
                  animate
                  outcomes={strategy.replay}
                  years={years}
                  label={t("stripLabel", {
                    name,
                    bad: count(strategy, "bad"),
                    watch: count(strategy, "watch"),
                    total: strategy.replay.length,
                  })}
                />
              </div>
            );
          })}
          <SeasonAxis years={years} />
          <p className="text-sm text-ink-muted">{t("proofHint")}</p>
        </div>
      </Block>

      <Block title={t("getTitle")}>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GET.map(([key, icon]) => (
            <IconCard key={key} icon={icon} title={t(`get.${key}.title`)} text={t(`get.${key}.text`)} />
          ))}
        </ul>
      </Block>

      <Block title={t("stepsTitle")}>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step} className="rounded-2xl border border-line bg-surface p-5">
              <span aria-hidden="true" className="font-display text-5xl font-semibold tabular-nums text-field">
                {index + 1}
              </span>
              <h3 className="mt-3 text-lg font-semibold">{t(`steps.${step}.title`)}</h3>
              <p className="mt-1 text-ink-muted">{t(`steps.${step}.text`)}</p>
            </li>
          ))}
        </ol>
      </Block>

      <Block title={t("audienceTitle")}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col rounded-2xl bg-field-strong p-6 text-on-field sm:p-8">
            <FieldIcon size={28} />
            <h3 className="mt-4 font-display text-2xl font-semibold">{t("farmer.title")}</h3>
            <p className="mt-2 flex-1 text-lg opacity-90">{t("farmer.text")}</p>
            <Link href="/field" className="press mt-6 inline-flex min-h-11 items-center self-start rounded-xl bg-surface px-5 font-semibold text-field-strong">
              {t("farmer.cta")}
            </Link>
          </div>
          <div className="flex flex-col rounded-2xl border border-line bg-surface p-6 sm:p-8">
            <BarnIcon size={28} className="text-ink-muted" />
            <h3 className="mt-4 font-display text-2xl font-semibold">{t("buyer.title")}</h3>
            <p className="mt-2 flex-1 text-lg text-ink-muted">{t("buyer.text")}</p>
            <Link href="/feed" className={buttonClass("secondary", "lg", "mt-6 self-start")}>
              {t("buyer.cta")}
            </Link>
          </div>
        </div>
      </Block>

      <Block title={t("limitsTitle")} lead={tAbout("judgmentDetail")}>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LIMITS.map((key) => (
            <li key={key} className="flex items-start gap-3 rounded-2xl bg-surface-sunken p-4">
              <CrossIcon size={18} className="mt-0.5 shrink-0 text-ink-muted" />
              <span>{tAbout(`limits.${key}`)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-3xl text-sm text-ink-muted">{tAbout("nasaNote")}</p>
      </Block>

      <section className="mt-20 flex flex-col items-start gap-5 rounded-2xl border border-line bg-surface p-8 sm:mt-28 sm:flex-row sm:items-center sm:justify-between sm:p-12">
        <div>
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("ctaTitle")}</h2>
          <p className="mt-2 text-lg text-ink-muted">{t("ctaText")}</p>
        </div>
        <Link href="/field" className={buttonClass("primary", "lg", "shrink-0")}>
          {t("start")}
        </Link>
      </section>
    </div>
  );
}
