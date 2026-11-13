import type { ComponentType } from "react";
import type { RiskLevel, Status } from "@/lib/contracts";
import { AlertIcon, CheckIcon, CrossIcon, DashIcon } from "./icons";

/** Visual tone shared by replay statuses and buyer risk levels. Never shown as colour alone. */
export type Tone = "good" | "watch" | "bad" | "nodata";

export const TONE_CLASSES: Record<Tone, { solid: string; soft: string; text: string }> = {
  good: { solid: "bg-status-good text-on-status", soft: "bg-status-good-tint", text: "text-status-good" },
  watch: { solid: "bg-status-watch text-on-status", soft: "bg-status-watch-tint", text: "text-status-watch" },
  bad: { solid: "bg-status-bad text-on-status", soft: "bg-status-bad-tint", text: "text-status-bad" },
  nodata: { solid: "bg-status-nodata text-on-status", soft: "bg-status-nodata-tint", text: "text-status-nodata" },
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
