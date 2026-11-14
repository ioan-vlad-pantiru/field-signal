"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Link, useRouter, usePathname } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button";
import { ArrowLeftIcon, CheckIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { CropSequence } from "@/components/ui/crop-chip";
import type { Crop, Strategy } from "@/lib/contracts";
import { ROTATION_CROPS } from "@/lib/crops";
import { mockFieldAnalysis } from "@/lib/mocks";
import { useLocalized } from "@/lib/localized";
import { DEMO_FIELD_IRREGULAR, DEMO_FIELD_RECT } from "@/lib/sim/geometry";
import { FieldSimulator } from "./field-simulator";

export type FieldShape = "rect" | "irregular";

const CROPS = new Set<string>([...ROTATION_CROPS, "fallow"]);

/** "maize,wheat,maize" → a 2–4 crop rotation, or null if anything is off. */
function parseSequence(raw: string | null): Strategy["sequence"] | null {
  if (!raw) return null;
  const crops = raw.split(",");
  if (crops.length < 2 || crops.length > 4 || !crops.every((c) => CROPS.has(c))) return null;
  return crops as Crop[] as Strategy["sequence"];
}

/** The /simulator page: pick a demo rotation and field shape, then watch it play. */
export function SimulatorView() {
  const query = useSearchParams();
  const strategyId = query.get("strategy");
  const shape: FieldShape = query.get("field") === "irregular" ? "irregular" : "rect";
  const t = useTranslations("Simulator");
  const l = useLocalized();
  const router = useRouter();
  const pathname = usePathname();
  const seqRaw = query.get("seq");
  // A rotation passed from the results screen (?seq=) that is not one of the demo ones.
  const custom = useMemo<Strategy | null>(() => {
    const seq = parseSequence(seqRaw);
    if (!seq) return null;
    const demo = mockFieldAnalysis.strategies;
    const match = demo.find((s) => s.id === strategyId);
    if (match && match.sequence.join(",") === seq.join(",")) return null;
    return {
      ...(match ?? demo[0]),
      id: strategyId ?? "custom",
      name: match?.name ?? { ro: "Rotația ta", en: "Your rotation" },
      sequence: seq,
    };
  }, [seqRaw, strategyId]);
  const strategies = custom
    ? [custom, ...mockFieldAnalysis.strategies.filter((s) => s.id !== custom.id)]
    : mockFieldAnalysis.strategies;
  const strategy = strategies.find((s) => s.id === strategyId) ?? strategies[0];

  const go = (next: { strategy?: string; field?: FieldShape }) => {
    const params = new URLSearchParams();
    const id = next.strategy ?? strategy.id;
    params.set("strategy", id);
    if (custom && id === custom.id) params.set("seq", custom.sequence.join(","));
    const field = next.field ?? shape;
    if (field !== "rect") params.set("field", field);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const chip = (active: boolean) =>
    `press min-h-11 rounded-xl border px-3 py-2 text-left ${active ? "border-field ring-1 ring-field" : "border-line hover:border-ink"}`;

  return (
    <div className="flex flex-col gap-5">
      {seqRaw ? (
        // Opened from a rotation's explanation on the results page.
        <Link href="/field" className={buttonClass("quiet", "md", "-ml-2 self-start")}>
          <ArrowLeftIcon /> {t("backToField")}
        </Link>
      ) : null}
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">{t("intro")}</p>
      </header>

      <fieldset className="min-w-0">
        <legend className="mb-2 font-medium">{t("strategyLabel")}</legend>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {strategies.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === strategy.id}
              onClick={() => go({ strategy: s.id })}
              className={`${chip(s.id === strategy.id)} flex shrink-0 flex-col gap-1.5`}
            >
              <span className="flex items-center gap-1.5 font-semibold">
                {s.id === strategy.id ? <CheckIcon size={16} className="text-field" /> : null}
                {l(s.name)}
              </span>
              <CropSequence sequence={s.sequence} />
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <p className="font-medium">{t("shapeLabel")}</p>
        <Segmented
          label={t("shapeLabel")}
          options={(["rect", "irregular"] as const).map((f) => ({ value: f, label: t(`shape.${f}`) }))}
          value={shape}
          onChange={(f) => go({ field: f })}
          className="self-start"
        />
      </div>

      <FieldSimulator
        key={`${strategy.id}-${shape}`}
        strategy={strategy}
        outlineMetres={shape === "irregular" ? DEMO_FIELD_IRREGULAR : DEMO_FIELD_RECT}
      />

      <p className="text-sm text-ink-muted">{t("demoNote")}</p>
    </div>
  );
}
