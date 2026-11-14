import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FeedView } from "@/components/feed/feed-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/feed">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Feed" });
  return { title: t("metaTitle") };
}

export default async function FeedPage({ params }: PageProps<"/[locale]/feed">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FeedView />;
}
