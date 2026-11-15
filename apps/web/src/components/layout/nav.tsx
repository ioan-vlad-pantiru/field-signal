"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { BarnIcon, FieldIcon, MoreIcon } from "@/components/ui/icons";

/** The three places in the app. `match` lists the old routes that still belong to each. */
export const NAV_ITEMS = [
  { href: "/field", key: "fields", Icon: FieldIcon, match: ["/field", "/farm", "/simulator"] },
  { href: "/buyers", key: "buyers", Icon: BarnIcon, match: ["/buyers", "/feed", "/stocks"] },
  { href: "/more", key: "more", Icon: MoreIcon, match: ["/more", "/account", "/about"] },
] as const;

export function activeNavIndex(pathname: string): number {
  return NAV_ITEMS.findIndex((item) => item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`)));
}

/**
 * Floating pill bar on phones: three items, the active one on a soft tint that slides between
 * them. Safe-area aware; hidden in print and from 640px (the top bar takes over). It leaves room
 * on the right for the round assistant button, which docks beside it at the same height.
 */
export function BottomBar() {
  const t = useTranslations("Nav");
  const active = activeNavIndex(usePathname());
  return (
    <nav
      aria-label={t("label")}
      className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[calc(var(--bar-gap)+env(safe-area-inset-bottom))] pl-4 pr-[calc(var(--bar-h)+1.5rem)] sm:hidden"
    >
      <ul className="pointer-events-auto relative isolate grid h-[var(--bar-h)] w-full max-w-72 grid-cols-3 rounded-pill bg-glass p-1.5 shadow-float backdrop-blur-xl">
        {active >= 0 ? (
          <span
            aria-hidden="true"
            className="nav-pill absolute inset-y-1.5 left-1.5 -z-10 w-[calc((100%-0.75rem)/3)] rounded-pill bg-field-soft"
            style={{ transform: `translateX(${active * 100}%)` }}
          />
        ) : null}
        {NAV_ITEMS.map(({ href, key, Icon }, i) => {
          const on = i === active;
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={`press flex h-full flex-col items-center justify-center gap-0.5 rounded-pill text-xs font-semibold ${
                  on ? "text-field-strong" : "text-ink-muted"
                }`}
              >
                <Icon size={22} />
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The same three items in the desktop header. */
export function TopNav() {
  const t = useTranslations("Nav");
  const active = activeNavIndex(usePathname());
  return (
    <nav aria-label={t("label")} className="hidden sm:block">
      <ul className="flex gap-1 rounded-pill bg-surface-sunken p-1">
        {NAV_ITEMS.map(({ href, key, Icon }, i) => {
          const on = i === active;
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={`press flex min-h-10 items-center gap-2 whitespace-nowrap rounded-pill px-4 text-sm font-semibold ${
                  on ? "bg-surface text-field-strong shadow-1" : "text-ink-muted hover:text-ink"
                }`}
              >
                <Icon size={18} />
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * EN | RO in one tap. Keeps the current page and its query (e.g. a pinned place or the stocks
 * path). Each language is written in itself, so it reads right whatever the page language is.
 */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  return (
    <Suspense fallback={<Switch query={null} className={className} />}>
      <SwitchWithQuery className={className} />
    </Suspense>
  );
}

function SwitchWithQuery({ className }: { className: string }) {
  const params = useSearchParams();
  return <Switch query={Object.fromEntries(params.entries())} className={className} />;
}

const NAMES: Record<string, string> = { en: "English", ro: "Română" };

function Switch({ query, className }: { query: Record<string, string> | null; className: string }) {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const locale = useLocale();
  const href = query && Object.keys(query).length > 0 ? { pathname, query } : pathname;
  return (
    <div role="group" aria-label={t("language")} className={`inline-flex rounded-pill bg-surface-sunken p-0.5 ${className}`}>
      {routing.locales.map((l) => {
        const on = l === locale;
        return (
          <Link
            key={l}
            href={href}
            locale={l}
            lang={l}
            hrefLang={l}
            aria-current={on ? "true" : undefined}
            aria-label={NAMES[l]}
            className={`press flex min-h-tap min-w-tap items-center justify-center rounded-pill px-3 text-sm font-semibold uppercase ${
              on ? "bg-surface text-ink shadow-1" : "text-ink-muted hover:text-ink"
            }`}
          >
            {l}
          </Link>
        );
      })}
    </div>
  );
}
