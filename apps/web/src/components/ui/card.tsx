import type { CSSProperties, ReactNode } from "react";

const CARD = "rounded-[var(--radius-lg)] bg-surface shadow-1";

export function cardClass(interactive = false, className = "") {
  return `${CARD} ${interactive ? "press text-left hover:shadow-2" : ""} ${className}`;
}

/** A rounded surface that rests on a soft shadow. `as` picks the element (section by default). */
export function Card({
  children,
  className = "",
  style,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: "section" | "div" | "article" | "li";
}) {
  return (
    <Tag style={style} className={`${CARD} p-4 ${className}`}>
      {children}
    </Tag>
  );
}
