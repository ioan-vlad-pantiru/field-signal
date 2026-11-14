"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { BarnIcon, BookIcon, FieldIcon, UserIcon } from "@/components/ui/icons";

const ITEMS = [
  { href: "/field", key: "field", Icon: FieldIcon },
  { href: "/feed", key: "feed", Icon: BarnIcon },
  { href: "/about", key: "about", Icon: BookIcon },
  { href: "/account", key: "account", Icon: UserIcon },
] as const;

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname.startsWith(href);
}

/** Fixed bottom tab bar on phones. */
export function BottomNav() {
  const t = useTranslations("Nav");
  const isActive = useIsActive();
  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      <ul className="grid grid-cols-4">
        {ITEMS.map(({ href, key, Icon }) => {
          const active = isActive(href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-sm font-medium ${
                  active ? "text-field" : "text-ink-muted"
                }`}
              >
                <span className={`rounded-full px-4 py-1 ${active ? "bg-field-tint" : ""}`}>
                  <Icon size={22} />
                </span>
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Inline links in the header on wider screens. */
export function TopNav() {
  const t = useTranslations("Nav");
  const isActive = useIsActive();
  return (
    <nav aria-label={t("label")} className="hidden sm:block">
      <ul className="flex gap-1">
        {ITEMS.map(({ href, key, Icon }) => {
          const active = isActive(href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-3 font-medium lg:px-4 ${
                  active ? "bg-field-tint text-field" : "text-ink-muted hover:text-ink"
                }`}
              >
                <Icon size={18} className="hidden md:block" />
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Keeps the query (e.g. a pinned commune from the feed screen) when the language changes. */
export function LocaleToggle() {
  return (
    <Suspense fallback={<LocaleLink query={null} />}>
      <LocaleLinkWithQuery />
    </Suspense>
  );
}

function LocaleLinkWithQuery() {
  const params = useSearchParams();
  return <LocaleLink query={Object.fromEntries(params.entries())} />;
}

function LocaleLink({ query }: { query: Record<string, string> | null }) {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const other = useLocale() === "ro" ? "en" : "ro";
  return (
    <Link
      href={query && Object.keys(query).length > 0 ? { pathname, query } : pathname}
      locale={other}
      className="press inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm font-semibold hover:border-field"
      aria-label={t("switchLocaleLabel")}
    >
      {t("switchLocale")}
    </Link>
  );
}
