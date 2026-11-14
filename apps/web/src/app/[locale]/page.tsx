import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Crop, Strategy } from "@/lib/contracts";
import { mockFieldAnalysis } from "@/lib/mocks";
import { buttonClass } from "@/components/ui/button";
import { CrossIcon } from "@/components/ui/icons";
import { SeasonAxis, SeasonLegend, SeasonStrip } from "@/components/ui/season-strip";
import { Section } from "@/components/ui/section";

const STEPS = ["field", "rotation", "result"] as const;
const LIMITS = ["hail", "pests", "markets", "management", "scale"] as const;

function count(strategy: Strategy, status: "bad" | "watch") {
  return strategy.replay.filter((o) => o.status === status).length;
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Home");
  const tCrops = await getTranslations("CropsShort");
  const tStatus = await getTranslations("Status");
  const tAbout = await getTranslations("About");
  const lang = locale === "en" ? "en" : "ro";

  // The proof strip is the real component on the bundled demo field, so every number is computed.
  const demo = mockFieldAnalysis;
  const strategies = [...demo.strategies].sort((a, b) => count(a, "bad") - count(b, "bad") || b.score.total - a.score.total);
  const current = strategies.find((s) => s.is_current) ?? strategies[strategies.length - 1];
  const best = strategies[0];
  const years = Array.from({ length: demo.period_end - demo.period_start + 1 }, (_, i) => demo.period_start + i);
  const crops = (sequence: readonly Crop[]) => sequence.map((c) => tCrops(c).toLocaleLowerCase(lang)).join(", ");

  return (
    <div>
      <section className="relative isolate flex min-h-[70svh] flex-col justify-end overflow-hidden rounded-2xl sm:min-h-[560px]">
        <Image
          src="/hero-transylvania.webp"
          alt={t("imageAlt")}
          fill
          priority
          sizes="(min-width: 1200px) 1168px, 100vw"
          className="-z-10 object-cover"
        />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/45 to-black/10" />
        <div className="flex max-w-3xl flex-col gap-4 p-5 text-white sm:p-10">
          <h1 className="text-[2rem] font-semibold leading-[1.08] tracking-tight sm:text-[3.25rem]">{t("title")}</h1>
          <p className="max-w-xl text-lg text-white/90 sm:text-xl">{t("lead")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/field" className={buttonClass("primary", "lg")}>
              {t("start")}
            </Link>
            <Link href="/feed" className="press inline-flex min-h-11 items-center font-medium underline underline-offset-4">
              {t("buyer")}
            </Link>
          </div>
          <p className="mt-2 text-xs text-white/70">{t("imageCredit")}</p>
        </div>
      </section>

      <Section title={t("proofTitle", { place: demo.location.commune ?? demo.location.label })} className="!mt-12 !border-t-0 !pt-0">
        <p className="max-w-3xl font-display text-2xl font-semibold leading-snug tracking-tight sm:text-4xl">
          {t("proofSentence", {
            current: count(current, "bad"),
            currentCrops: crops(current.sequence),
            best: count(best, "bad"),
            bestCrops: crops(best.sequence),
          })}
        </p>
        <div className="mt-8 flex max-w-3xl flex-col gap-5">
          {strategies.map((strategy) => {
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
          <SeasonLegend
            labels={{ good: tStatus("good"), watch: tStatus("watch"), bad: tStatus("bad"), no_data: tStatus("no_data"), lowEvidence: t("weakEvidence") }}
          />
          <p className="text-sm text-ink-muted">
            {t("proofHint", { start: demo.period_start, end: demo.period_end })} {t("proofDemo")}
          </p>
        </div>
      </Section>

      <Section title={t("stepsTitle")}>
        <ol className="grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step}>
              <span aria-hidden="true" className="font-display text-4xl font-semibold tabular-nums text-field">
                {index + 1}
              </span>
              <h3 className="mt-2 text-xl font-semibold">{t(`steps.${step}.title`)}</h3>
              <p className="mt-1 text-ink-muted">{t(`steps.${step}.text`)}</p>
            </li>
          ))}
        </ol>
        <Link href="/field" className={buttonClass("primary", "lg", "mt-8")}>
          {t("start")}
        </Link>
      </Section>

      <Section title={t("buyerTitle")} hint={t("buyerText")}>
        <Link href="/feed" className={buttonClass("secondary")}>
          {t("buyerLink")}
        </Link>
      </Section>

      <Section title={t("limitsTitle")} hint={t("limitsLead")}>
        <ul className="grid max-w-3xl gap-x-8 gap-y-2 sm:grid-cols-2">
          {LIMITS.map((key) => (
            <li key={key} className="flex items-start gap-2">
              <CrossIcon size={18} className="mt-1 shrink-0 text-ink-muted" />
              <span>{tAbout(`limits.${key}`)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-3xl text-sm text-ink-muted">{tAbout("nasaNote")}</p>
      </Section>
    </div>
  );
}
