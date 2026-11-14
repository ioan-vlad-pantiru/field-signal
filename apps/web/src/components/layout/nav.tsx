"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { BarnIcon, BookIcon, FieldIcon } from "@/components/ui/icons";

const ITEMS = [
  { href: "/field", key: "field", Icon: FieldIcon },
  { href: "/feed", key: "feed", Icon: BarnIcon },
  { href: "/about", key: "about", Icon: BookIcon },
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
      <ul className="grid grid-cols-3">
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
                className={`flex min-h-11 items-center gap-2 rounded-full px-4 font-medium ${
                  active ? "bg-field-tint text-field" : "text-ink-muted hover:text-ink"
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

export function LocaleToggle() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const other = useLocale() === "ro" ? "en" : "ro";
  return (
    <Link
      href={pathname}
      locale={other}
      className="press inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm font-semibold hover:border-field"
      aria-label={t("switchLocaleLabel")}
    >
      {t("switchLocale")}
    </Link>
  );
}
