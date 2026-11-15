import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "tonal" | "quiet";
export type ButtonSize = "md" | "lg";

const BASE =
  "press inline-flex select-none items-center justify-center gap-2 rounded-pill font-semibold disabled:pointer-events-none disabled:opacity-40";
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-field text-on-field shadow-1 hover:bg-field-strong",
  secondary: "bg-surface text-ink shadow-1 ring-1 ring-line hover:ring-ink-muted",
  tonal: "bg-field-soft text-field-strong hover:bg-field-tint",
  quiet: "text-field hover:bg-surface-sunken",
};
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-tap px-4",
  lg: "min-h-14 px-6 text-lg",
};

/** Class string for anything that should look like a button, such as a `Link`. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

const ICON_VARIANTS = {
  plain: "text-ink hover:bg-surface-sunken",
  filled: "bg-surface-sunken text-ink hover:bg-line",
  float: "bg-glass text-ink shadow-float backdrop-blur-md hover:bg-surface",
  active: "bg-field text-on-field shadow-float",
} as const;

export function iconButtonClass(variant: keyof typeof ICON_VARIANTS = "plain", className = "") {
  return `press inline-flex size-tap shrink-0 items-center justify-center rounded-full disabled:pointer-events-none disabled:opacity-40 ${ICON_VARIANTS[variant]} ${className}`;
}

/** A round 44px button with only an icon; `label` is its accessible name (and tooltip). */
export function IconButton({
  label,
  variant = "plain",
  className = "",
  type = "button",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  label: string;
  variant?: keyof typeof ICON_VARIANTS;
}) {
  return (
    <button type={type} aria-label={label} title={label} className={iconButtonClass(variant, className)} {...props} />
  );
}
