"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { REPO_URL } from "@/lib/site";
import { GitHubIcon, LogoMark } from "@/components/ui/icons";
import { LanguageSwitch, TopNav } from "./nav";

/**
 * Desktop: logo, the three places, the link to the source code and the language switch. Phones: only
 * on the start page (app screens carry their own title; the language switch and the code link live
 * in More).
 */
export function SiteHeader() {
  const t = useTranslations("Nav");
  const home = usePathname() === "/";
  return (
    <header className={`no-print sticky top-0 z-20 bg-ground/85 backdrop-blur-md ${home ? "" : "max-sm:hidden"}`}>
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-3 px-gutter">
        <Link href="/" aria-label={t("home")} className="press flex min-h-tap items-center gap-2.5 rounded-pill">
          <LogoMark size={30} />
          <span className="whitespace-nowrap text-lg font-semibold tracking-tight">Field Signal</span>
        </Link>
        <TopNav />
        <div className="flex items-center gap-1">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("code")}
            title={t("code")}
            className="press flex size-tap items-center justify-center rounded-pill text-ink-muted hover:text-ink"
          >
            <GitHubIcon size={22} />
          </a>
          <LanguageSwitch />
        </div>
      </div>
    </header>
  );
}
