"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { AdoptionScenario } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import {
  MEAL_YIELD,
  coverage,
  loadSoyNeed,
  parseTonnes,
  roundPct,
  saveSoyNeed,
  scaleToAdoption,
  type SoyForm,
} from "@/lib/soy";
import { RangeBar } from "@/components/ui/charts";
import { Disclosure } from "@/components/ui/disclosure";
import { Segmented } from "@/components/ui/segmented";
import { useAdoptionPct } from "./adoption-slider";

const FORMS: readonly SoyForm[] = ["beans", "meal"];

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {hint ? <p className="mt-1 max-w-[65ch] text-ink-muted">{hint}</p> : null}
      <div className="mt-4 flex max-w-[720px] flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * How much of the buyer's own soy purchase the extra local soy from the slider could cover.
 * The buyer's figure stays in this browser (localStorage); it is never sent to the server.
 */
export function SoyImports({ scenario }: { scenario: AdoptionScenario }) {
  const t = useTranslations("FeedExtra.need");
  const locale = useAppLocale();
  const inputId = useId();
  const pct = useAdoptionPct(Math.round(scenario.adoption_pct));
  const [{ text, form }, setNeed] = useState<{ text: string; form: SoyForm }>({ text: "", form: "beans" });

  // Read the remembered figure after mount, so the server render and the first client render match.
  useEffect(() => {
    const saved = loadSoyNeed();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from localStorage
    setNeed({ text: saved.tonnes != null ? String(saved.tonnes) : "", form: saved.form });
  }, []);

  function update(nextText: string, nextForm: SoyForm) {
    setNeed({ text: nextText, form: nextForm });
    saveSoyNeed({ tonnes: parseTonnes(nextText), form: nextForm });
  }

  const tonnes = parseTonnes(text);
  const beans = scaleToAdoption(scenario.added_production_t, scenario.adoption_pct, pct);
  const share = coverage(beans, tonnes, form);
  const n0 = (v: number) => formatNumber(v, locale, 0);
  const p = (v: number) => formatNumber(roundPct(v), locale, 1);

  return (
    <Card title={t("title")} hint={t("hint")}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="font-medium">
          {t("inputLabel")}
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          placeholder={t("inputPlaceholder")}
          onChange={(event) => update(event.target.value, form)}
          className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-lg tabular-nums sm:max-w-xs"
        />
        <p className="text-sm text-ink-muted">{t("private")}</p>
      </div>

      <Segmented
        label={t("formLabel")}
        value={form}
        onChange={(value) => update(text, value)}
        options={FORMS.map((value) => ({ value, label: t(`form.${value}`) }))}
        className="w-full sm:w-auto sm:self-start"
      />

      <div aria-live="polite" className="flex flex-col gap-2">
        <p className="text-ink-muted">
          {t("supply", { pct, low: n0(beans.low), high: n0(beans.high) })}
        </p>
        {share ? (
          <>
            <p className="text-lg font-medium">
              {t("coverage", { low: p(share.low), high: p(share.high), mid: p(share.mid) })}
            </p>
            <RangeBar
              range={share}
              domain={[0, Math.max(100, share.high)]}
              label={t("coverage", { low: p(share.low), high: p(share.high), mid: p(share.mid) })}
            />
            <p className="flex justify-between text-sm text-ink-muted tabular-nums" aria-hidden="true">
              <span>0%</span>
              <span>{share.high > 100 ? `${p(Math.max(100, share.high))}%` : "100%"}</span>
            </p>
            {share.mid >= 100 ? <p className="text-ink-muted">{t("more")}</p> : null}
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-line p-4 text-ink-muted">{t("empty")}</p>
        )}
      </div>

      <Disclosure summary={t("assumptions")}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>{t("assumeSlider")}</li>
          {form === "meal" ? (
            <li>
              {t("assumeMeal", {
                low: formatNumber(MEAL_YIELD.low, locale, 2),
                high: formatNumber(MEAL_YIELD.high, locale, 2),
              })}
            </li>
          ) : null}
          <li>{t("assumeAll")}</li>
        </ul>
      </Disclosure>
    </Card>
  );
}

const SOURCES = [
  { key: "german", href: "https://mdpi.com/2073-4395/10/12/1847" },
  { key: "central", href: "https://agris.fao.org/search/ar/records/65de16b463b8185d9ca6fee9" },
  { key: "varieties", href: "https://doaj.org/article/042b84e40d6f4351a7c0eeae4587c880" },
  { key: "eudrDonau", href: "https://www.donausoja.org/eudr-postponement-approved-eu-deforestation-regulation-delayed-to-2026/" },
  { key: "eudrArthurCox", href: "https://www.arthurcox.com/insights/eudr-one-year-postponement-agreed/" },
] as const;

/** What drives local soy quality and what a buyer can do about it; the import rules come second. */
export function SoyQuality() {
  const t = useTranslations("FeedExtra.quality");
  const actions = ["action1", "action2", "action3"] as const;
  return (
    <Card title={t("title")} hint={t("intro")}>
      <div>
        <h3 className="font-medium">{t("driversTitle")}</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>{t("driverSeason")}</li>
          <li>{t("driverGerman")}</li>
          <li>{t("driverVariety")}</li>
        </ul>
      </div>

      <div>
        <h3 className="font-medium">{t("actionsTitle")}</h3>
        <ol className="mt-2 flex flex-col gap-2">
          {actions.map((key, index) => (
            <li key={key} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-field-tint text-sm font-semibold tabular-nums text-field-strong"
              >
                {index + 1}
              </span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ol>
      </div>

      <Disclosure summary={t("importsTitle")}>
        <div className="flex flex-col gap-2 text-ink-muted">
          <p>{t("importsChain")}</p>
          <p>{t("eudr")}</p>
          <p>{t("trace")}</p>
          <p className="text-sm">{t("eudrCheck")}</p>
        </div>
      </Disclosure>

      <div>
        <h3 className="text-sm font-medium text-ink-muted">{t("sourcesTitle")}</h3>
        <ul className="mt-1 flex flex-col gap-1 text-sm">
          {SOURCES.map((s) => (
            <li key={s.key}>
              <a href={s.href} target="_blank" rel="noopener noreferrer" className="break-words text-field underline underline-offset-2">
                {t(`source.${s.key}`)}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
