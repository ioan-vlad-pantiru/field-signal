import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MoreView } from "@/components/more/more-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/more">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "More" });
  return { title: t("title") };
}

export default async function MorePage({ params }: PageProps<"/[locale]/more">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <MoreView />;
}
