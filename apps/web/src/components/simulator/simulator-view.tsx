"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Chip, ChipRow } from "@/components/ui/chip";
import { CropDot } from "@/components/ui/crop-chip";
import { FieldIcon } from "@/components/ui/icons";
import { InfoTip } from "@/components/ui/info-tip";
import { ScreenHeader } from "@/components/ui/screen-header";
import { BackLink } from "@/components/more/back-link";
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

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader
        back={seqRaw ? <BackLink href="/field" label={t("backToField")} /> : undefined}
        title={t("title")}
        meta={t("intro")}
        actions={<InfoTip label={t("aboutDemo")}>{t("demoNote")}</InfoTip>}
      />

      <div className="flex flex-col gap-1">
        <ChipRow label={t("strategyLabel")}>
          {strategies.map((s) => (
            <Chip key={s.id} selected={s.id === strategy.id} onClick={() => go({ strategy: s.id })}>
              <span className="flex gap-0.5" aria-hidden="true">
                {s.sequence.map((crop, i) => (
                  <CropDot key={i} crop={crop} />
                ))}
              </span>
              {l(s.name)}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label={t("shapeLabel")}>
          {(["rect", "irregular"] as const).map((f) => (
            <Chip key={f} selected={shape === f} onClick={() => go({ field: f })}>
              <FieldIcon size={16} />
              {t(`shape.${f}`)}
            </Chip>
          ))}
        </ChipRow>
      </div>

      <FieldSimulator
        key={`${strategy.id}-${shape}`}
        strategy={strategy}
        outlineMetres={shape === "irregular" ? DEMO_FIELD_IRREGULAR : DEMO_FIELD_RECT}
      />
    </div>
  );
}
