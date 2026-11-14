import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LogoMark } from "@/components/ui/icons";
import { LocaleToggle, TopNav } from "./nav";

export async function SiteHeader() {
  const t = await getTranslations("App");
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ground/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-3 px-4">
        <Link href="/" className="press flex min-h-11 items-center gap-2.5 rounded-lg">
          <LogoMark size={32} />
          <span className="text-lg font-semibold tracking-tight">{t("name")}</span>
        </Link>
        <TopNav />
        <LocaleToggle />
      </div>
    </header>
  );
}
