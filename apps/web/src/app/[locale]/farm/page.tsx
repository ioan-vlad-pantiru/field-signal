import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FarmView } from "@/components/farm/farm-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/farm">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Farm" });
  return { title: t("title") };
}

export default async function FarmPage({ params }: PageProps<"/[locale]/farm">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FarmView />;
}
