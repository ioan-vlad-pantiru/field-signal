import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BuyersView } from "@/components/buyers/buyers-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/buyers">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Buyers" });
  return { title: t("title") };
}

export default async function BuyersPage({ params }: PageProps<"/[locale]/buyers">) {
  const { locale } = await params;
  setRequestLocale(locale);
  // ?view= and ?path= are read on the client, so the page itself stays static.
  return (
    <Suspense>
      <BuyersView />
    </Suspense>
  );
}
