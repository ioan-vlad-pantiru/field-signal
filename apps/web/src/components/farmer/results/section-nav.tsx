"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export type SectionId = "shift" | "rotations" | "plan" | "evidence";

/** Laptop only: sticky links to the page's sections, marking the one in view. */
export function SectionNav({ sections }: { sections: SectionId[] }) {
  const t = useTranslations("Results.nav");
  const [active, setActive] = useState<SectionId | null>(null);

  useEffect(() => {
    const targets = sections.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id as SectionId);
      },
      // A section counts as current while it crosses the band just under the sticky bars.
      { rootMargin: "-120px 0px -60% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav
      aria-label={t("label")}
      className="no-print sticky top-16 z-10 -mx-4 hidden border-b border-line bg-ground/95 px-4 backdrop-blur lg:block"
    >
      <ul className="flex gap-1">
        {sections.map((id) => (
          <li key={id}>
            <a
              href={`#${id}`}
              aria-current={active === id ? "location" : undefined}
              className={`relative inline-flex min-h-12 items-center px-3 font-medium ${
                active === id
                  ? "text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-field"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {t(id)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
