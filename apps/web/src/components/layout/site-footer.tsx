import { getTranslations } from "next-intl/server";

export async function SiteFooter() {
  const t = await getTranslations("Footer");
  return (
    <footer className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-10 text-sm text-ink-muted sm:pb-10">
      <p>{t("credit")}</p>
      <p className="mt-1">{t("team")}</p>
    </footer>
  );
}
