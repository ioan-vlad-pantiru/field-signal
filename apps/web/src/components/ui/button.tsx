import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "md" | "lg";

const BASE =
  "press inline-flex items-center justify-center gap-2 rounded-xl font-medium disabled:pointer-events-none disabled:opacity-40";
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-field text-on-field hover:bg-field-strong",
  secondary: "border border-line bg-surface text-ink hover:border-ink",
  quiet: "text-field hover:bg-surface-sunken",
};
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-4",
  lg: "min-h-14 px-6 text-lg font-semibold",
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
