import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StocksView } from "@/components/stocks/stocks-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/stocks">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Stocks" });
  return { title: t("metaTitle") };
}

export default async function StocksPage({ params }: PageProps<"/[locale]/stocks">) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The path (A/B) and the selected row are client state, so the page stays static.
  return <StocksView />;
}
