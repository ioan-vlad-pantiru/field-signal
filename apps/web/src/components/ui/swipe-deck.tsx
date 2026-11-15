"use client";

import { Children, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Cards in a row that snap one at a time on phones (native scroll-snap, so the browser does the
 * physics), with a dot per card. From `lg` the cards sit in a grid and the dots go.
 * `active` scrolls that card into view; `onActive` reports the card that settled in view.
 */
export function SwipeDeck({
  label,
  children,
  active,
  onActive,
  dotLabel,
}: {
  label: string;
  children: ReactNode;
  active?: number;
  onActive?: (index: number) => void;
  /** Accessible name for the dot of card `i` (0-based). */
  dotLabel: (index: number) => string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children);
  const [shown, setShown] = useState(active ?? 0);
  const report = useRef(onActive);
  useEffect(() => {
    report.current = onActive;
  }, [onActive]);

  // The card most in view is the one shown; it settles as the snap ends.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // In the desktop grid every card is in view: nothing to report.
        if (el.scrollWidth <= el.clientWidth + 1) return;
        for (const entry of entries) {
          if (entry.intersectionRatio < 0.6) continue;
          const index = Number((entry.target as HTMLElement).dataset.index);
          setShown(index);
          report.current?.(index);
        }
      },
      { root: el, threshold: [0.6] },
    );
    Array.from(el.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [items.length]);

  useEffect(() => {
    const el = track.current;
    if (active == null || !el) return;
    const card = el.children[active] as HTMLElement | undefined;
    // Only when the deck scrolls sideways (phones); in the grid layout nothing moves.
    if (card && el.scrollWidth > el.clientWidth) el.scrollTo({ left: card.offsetLeft - el.offsetLeft - parseFloat(getComputedStyle(el).scrollPaddingInlineStart || "0"), behavior: "smooth" });
  }, [active]);

  function go(index: number) {
    const el = track.current;
    const card = el?.children[index] as HTMLElement | undefined;
    card?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const next = Math.min(items.length - 1, Math.max(0, shown + step));
    if (next === shown) return;
    event.preventDefault();
    go(next);
    (track.current?.children[next]?.querySelector("button,a") as HTMLElement | null)?.focus({ preventScroll: true });
  }

  return (
    <div role="region" aria-roledescription="carousel" aria-label={label}>
      <div
        ref={track}
        onKeyDown={onKeyDown}
        className="snap-deck -mx-gutter flex gap-3 overflow-x-auto px-gutter pb-3 pt-1 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0"
      >
        {items.map((child, i) => (
          <div
            key={i}
            data-index={i}
            role="group"
            aria-roledescription="slide"
            className="w-[86%] max-w-sm shrink-0 sm:w-[60%] lg:w-auto lg:max-w-none"
          >
            {child}
          </div>
        ))}
      </div>
      {items.length > 1 ? (
        <div className="flex justify-center lg:hidden">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={dotLabel(i)}
              aria-current={i === shown ? "true" : undefined}
              onClick={() => go(i)}
              className="-my-2.5 flex size-tap items-center justify-center"
            >
              <span
                className={`h-1.5 rounded-pill transition-all duration-[var(--duration-slow)] ease-[var(--ease-spring)] ${
                  i === shown ? "w-5 bg-field" : "w-1.5 bg-line"
                }`}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
