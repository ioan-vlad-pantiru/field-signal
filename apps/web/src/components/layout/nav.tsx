"use client";

import { Suspense, useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import {
  BarnIcon,
  BookIcon,
  CheckIcon,
  ChevronDownIcon,
  FieldIcon,
  GlobeIcon,
  GridIcon,
  LayersIcon,
  UserIcon,
} from "@/components/ui/icons";

const ITEMS = [
  { href: "/field", key: "field", Icon: FieldIcon },
  { href: "/farm", key: "farm", Icon: GridIcon },
  { href: "/feed", key: "feed", Icon: BarnIcon },
  { href: "/stocks", key: "stocks", Icon: LayersIcon },
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
      <ul className="grid grid-cols-6">
        {ITEMS.map(({ href, key, Icon }) => {
          const active = isActive(href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  active ? "text-field" : "text-ink-muted"
                }`}
              >
                <span className={`rounded-full px-3 py-1 ${active ? "bg-field-tint" : ""}`}>
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
                title={t(key)}
                className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-3 font-medium ${
                  active ? "bg-field-tint text-field" : "text-ink-muted hover:text-ink"
                }`}
              >
                {/* Six items: icons only on tablets, labels only at lg, both at xl. */}
                <Icon size={18} className="lg:hidden xl:block" />
                <span className="sr-only lg:not-sr-only">{t(key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Keeps the query (e.g. a pinned commune from the feed screen) when the language changes. */
/** Each language in its own name, so it reads right whatever the page language is. */
const LANGUAGES = [
  { locale: "ro", code: "RO", name: "Română" },
  { locale: "en", code: "EN", name: "English" },
] as const;

/**
 * Shows the language the site is in; opens a short list to pick another. Keeps the current page
 * and its query string.
 */
export function LocaleToggle() {
  return (
    <Suspense fallback={<LocalePicker query={null} />}>
      <LocalePickerWithQuery />
    </Suspense>
  );
}

function LocalePickerWithQuery() {
  const params = useSearchParams();
  return <LocalePicker query={Object.fromEntries(params.entries())} />;
}

function LocalePicker({ query }: { query: Record<string, string> | null }) {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const locale = useLocale();
  const current = LANGUAGES.find((l) => l.locale === locale) ?? LANGUAGES[0];
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const href = query && Object.keys(query).length > 0 ? { pathname, query } : pathname;

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t("languageLabel", { current: current.name })}
        onClick={() => setOpen((v) => !v)}
        className="press inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-semibold hover:border-field aria-expanded:border-field"
      >
        <GlobeIcon size={16} className="text-ink-muted" />
        <span>{current.name}</span>
        <ChevronDownIcon
          size={14}
          className={`text-ink-muted transition-transform duration-[var(--duration-fast)] ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        id={listId}
        hidden={!open}
        className="absolute right-0 top-full z-30 mt-2 w-48 rounded-xl border border-line bg-surface p-1.5 shadow-[var(--shadow-2)]"
      >
        <p className="px-2.5 pb-1 pt-1.5 text-xs text-ink-muted">{t("language")}</p>
        <ul>
          {LANGUAGES.map((l) => {
            const active = l.locale === current.locale;
            return (
              <li key={l.locale}>
                <Link
                  href={href}
                  locale={l.locale}
                  lang={l.locale}
                  hrefLang={l.locale}
                  aria-current={active ? "true" : undefined}
                  onClick={() => setOpen(false)}
                  className={`flex min-h-11 items-center justify-between gap-3 rounded-lg px-2.5 text-sm hover:bg-surface-sunken ${
                    active ? "font-semibold text-field" : ""
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    {l.name}
                    <span className="text-xs font-normal text-ink-muted">{l.code}</span>
                  </span>
                  {active && <CheckIcon size={16} />}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
