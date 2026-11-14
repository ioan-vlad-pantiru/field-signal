import { setRequestLocale } from "next-intl/server";
import { FarmerFlow } from "@/components/farmer/farmer-flow";

export default async function FieldPage({ params }: PageProps<"/[locale]/field">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FarmerFlow />;
}
