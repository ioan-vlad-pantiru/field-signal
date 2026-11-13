import type { ComponentType } from "react";
import type { RiskLevel, Status } from "@/lib/contracts";
import { AlertIcon, CheckIcon, CrossIcon, DashIcon } from "./icons";

/** Visual tone shared by replay statuses and buyer risk levels. Never shown as colour alone. */
export type Tone = "good" | "watch" | "bad" | "nodata";

export const TONE_CLASSES: Record<Tone, { solid: string; soft: string; text: string }> = {
  good: { solid: "bg-good text-surface", soft: "bg-good-soft", text: "text-good" },
  watch: { solid: "bg-watch text-surface", soft: "bg-watch-soft", text: "text-watch" },
  bad: { solid: "bg-bad text-surface", soft: "bg-bad-soft", text: "text-bad" },
  nodata: { solid: "bg-nodata text-surface", soft: "bg-nodata-soft", text: "text-nodata" },
};

export const TONE_ICONS: Record<Tone, ComponentType<{ size?: number }>> = {
  good: CheckIcon,
  watch: AlertIcon,
  bad: CrossIcon,
  nodata: DashIcon,
};

export const STATUS_TONE: Record<Status, Tone> = {
  good: "good",
  watch: "watch",
  bad: "bad",
  no_data: "nodata",
};

/** Buyer risk: low risk is good news. */
export const RISK_TONE: Record<RiskLevel, Tone> = {
  low: "good",
  medium: "watch",
  high: "bad",
};
