import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FarmerFlow } from "@/components/farmer/farmer-flow";

export async function generateMetadata({ params }: PageProps<"/[locale]/field">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Nav" });
  return { title: t("fields") };
}

export default async function FieldPage({ params }: PageProps<"/[locale]/field">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FarmerFlow />;
}
