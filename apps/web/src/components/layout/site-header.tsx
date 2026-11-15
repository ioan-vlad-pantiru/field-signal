"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LogoMark } from "@/components/ui/icons";
import { LanguageSwitch, TopNav } from "./nav";

/**
 * Desktop: logo, the three places and the language switch. Phones: only on the start page (app
 * screens carry their own title, and the language switch lives in More).
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
        <LanguageSwitch />
      </div>
    </header>
  );
}
