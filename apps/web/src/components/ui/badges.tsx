"use client";

import { useTranslations } from "next-intl";
import { ShieldIcon } from "./icons";
import type { RiskLevel, Status } from "@/lib/contracts";
import { RISK_TONE, STATUS_TONE, TONE_CLASSES, TONE_ICONS, type Tone } from "./tone";

export function ToneBadge({ tone, label, prefix }: { tone: Tone; label: string; prefix?: string }) {
  const Icon = TONE_ICONS[tone];
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${prefix ? "" : "shrink-0 whitespace-nowrap"} ${TONE_CLASSES[tone].soft} ${TONE_CLASSES[tone].text}`}
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

export function AgronomistBadge() {
  const t = useTranslations("Common");
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full border border-line px-2.5 py-1 text-sm font-semibold text-ink">
      <ShieldIcon size={16} />
      {t("verifyAgronomist")}
    </span>
  );
}
