"use client";

import { useTranslations } from "next-intl";
import { ShieldIcon } from "./icons";
import type { Confidence, RiskLevel, Status } from "@/lib/contracts";
import { RISK_TONE, STATUS_TONE, TONE_CLASSES, TONE_ICONS, type Tone } from "./tone";

export function ToneBadge({ tone, label, prefix }: { tone: Tone; label: string; prefix?: string }) {
  const Icon = TONE_ICONS[tone];
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${TONE_CLASSES[tone].soft} ${TONE_CLASSES[tone].text}`}
    >
      <Icon size={16} />
      <span className="text-ink">
        {prefix ? `${prefix}: ` : null}
        {label}
      </span>
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const t = useTranslations("Status");
  return <ToneBadge tone={STATUS_TONE[status]} label={t(status)} />;
}

export function RiskBadge({ level, prefix }: { level: RiskLevel; prefix?: string }) {
  const t = useTranslations("Risk");
  return <ToneBadge tone={RISK_TONE[level]} label={t(level)} prefix={prefix} />;
}

const CONFIDENCE_DOTS: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const t = useTranslations("Confidence");
  const filled = CONFIDENCE_DOTS[confidence];
  return (
    <span className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2.5 py-1 text-sm">
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((dot) => (
          <span
            key={dot}
            className={`h-2 w-2 rounded-full ${dot <= filled ? "bg-field" : "bg-line"}`}
          />
        ))}
      </span>
      {t("label", { level: t(confidence) })}
    </span>
  );
}

export function AgronomistBadge() {
  const t = useTranslations("Common");
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full border border-line px-2.5 py-1 text-sm font-semibold text-ink">
      <ShieldIcon size={16} />
      {t("verifyAgronomist")}
    </span>
  );
}
