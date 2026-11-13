import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SimulatorView } from "@/components/simulator/simulator-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/simulator">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Simulator" });
  return { title: t("eyebrow") };
}

export default async function SimulatorPage({ params }: PageProps<"/[locale]/simulator">) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The view reads ?strategy= and ?field= on the client, so the page itself stays static.
  return (
    <Suspense>
      <SimulatorView />
    </Suspense>
  );
}
