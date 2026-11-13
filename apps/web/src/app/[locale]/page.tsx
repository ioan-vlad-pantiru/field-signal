import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { RomaniaMap } from "@/components/romania-map";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Home");
  const otherLocale = locale === "ro" ? "en" : "ro";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:py-12">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("title")}
        </h1>
        <Link
          href="/"
          locale={otherLocale}
          className="shrink-0 rounded-md border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5"
        >
          {t("switchLocale")}
        </Link>
      </header>
      <p className="text-lg text-foreground/80">{t("tagline")}</p>
      <p className="text-sm text-foreground/60">{t("status")}</p>
      <RomaniaMap label={t("mapLabel")} />
    </main>
  );
}
