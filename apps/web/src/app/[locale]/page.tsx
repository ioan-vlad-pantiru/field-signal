import Image from "next/image";
import type { ComponentType } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Crop, Strategy } from "@/lib/contracts";
import { mockFieldAnalysis } from "@/lib/mocks";
import { buttonClass } from "@/components/ui/button";
import { cardClass } from "@/components/ui/card";
import { BarnIcon, ChevronRightIcon, FieldIcon, GridIcon, LeafIcon, PinIcon } from "@/components/ui/icons";
import { SeasonAxis, SeasonStrip } from "@/components/ui/season-strip";
import { HeroScene } from "@/components/home/hero-scene";

type Icon = ComponentType<{ size?: number; className?: string }>;

const STEPS: [string, Icon][] = [
  ["field", PinIcon],
  ["rotation", LeafIcon],
  ["result", GridIcon],
];
const DOORS: [string, string, Icon][] = [
  ["farmer", "/field", FieldIcon],
  ["buyer", "/buyers", BarnIcon],
];

function count(strategy: Strategy, status: "bad" | "watch") {
  return strategy.replay.filter((o) => o.status === status).length;
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Home");
  const tCrops = await getTranslations("CropsShort");
  const lang = locale === "en" ? "en" : "ro";

  // The example is the real component on the bundled demo field, so every number is computed.
  const demo = mockFieldAnalysis;
  const strategies = [...demo.strategies].sort((a, b) => count(a, "bad") - count(b, "bad") || b.score.total - a.score.total);
  const current = strategies.find((s) => s.is_current) ?? strategies[strategies.length - 1];
  const best = strategies[0];
  const years = Array.from({ length: demo.period_end - demo.period_start + 1 }, (_, i) => demo.period_start + i);
  const crops = (sequence: readonly Crop[]) => sequence.map((c) => tCrops(c).toLocaleLowerCase(lang)).join(", ");

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
          <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{t("title")}</h1>
          <p className="max-w-xl text-base text-white/90 sm:text-lg">{t("lead")}</p>
          <Link href="/field" className={buttonClass("primary", "lg", "mt-2 self-start")}>
            {t("start")}
          </Link>
          <p className="mt-2 text-xs text-white/70 group-has-[[data-scene=ready]]:hidden">{t("imageCredit")}</p>
          <p className="mt-2 hidden text-xs text-white/70 group-has-[[data-scene=ready]]:block">{t("sceneNote")}</p>
        </div>
      </section>


      <section aria-labelledby="proof-title" className={cardClass(false, "mt-4 flex flex-col gap-4 p-5 sm:mt-6 sm:p-8")}>
        <div>
          <h2 id="proof-title" className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            {t("proof.title", { seasons: years.length, place: demo.location.commune ?? demo.location.label })}
          </h2>
          <p className="mt-1 text-ink-muted">
            {t("proof.line", {
              current: count(current, "bad"),
              currentCrops: crops(current.sequence),
              best: count(best, "bad"),
              bestCrops: crops(best.sequence),
            })}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {[current, best].map((strategy) => {
            const name = strategy.is_current ? t("proof.current") : strategy.name[lang];
            return (
              <div key={strategy.id}>
                <p className="mb-1.5 text-sm font-semibold">{name}</p>
                <SeasonStrip
                  animate
                  outcomes={strategy.replay}
                  years={years}
                  label={t("proof.stripLabel", {
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
        </div>
        <p className="text-sm text-ink-muted">{t("proof.legend")}</p>
      </section>

      <section aria-labelledby="steps-title" className="mt-12 sm:mt-16">
        <h2 id="steps-title" className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
          {t("steps.title")}
        </h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {STEPS.map(([step, Icon], index) => (
            <li key={step} className={cardClass(false, "flex items-center gap-3 p-4")}>
              <span className="flex size-tap shrink-0 items-center justify-center rounded-full bg-field-soft text-field-strong">
                <Icon size={20} />
              </span>
              <p>
                <span className="sr-only">{index + 1}. </span>
                {t(`steps.${step}`)}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="doors-title" className="mt-12 sm:mt-16">
        <h2 id="doors-title" className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
          {t("doors.title")}
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {DOORS.map(([door, href, Icon]) => (
            <Link key={door} href={href} className={cardClass(true, "flex min-h-tap items-center gap-4 p-5")}>
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-field-soft text-field-strong">
                <Icon size={24} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold">{t(`doors.${door}.title`)}</span>
                <span className="block text-ink-muted">{t(`doors.${door}.text`)}</span>
              </span>
              <ChevronRightIcon size={20} className="shrink-0 text-ink-muted" />
            </Link>
          ))}
        </div>
      </section>

      <footer className="mt-12 text-center text-sm text-ink-muted sm:mt-16">{t("credit")}</footer>
    </div>
  );
}
