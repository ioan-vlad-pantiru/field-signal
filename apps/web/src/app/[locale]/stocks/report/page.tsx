import type { Metadata } from "next";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { StocksReport } from "@/components/stocks/stocks-report";

// The report is Romanian only (it is written for Transavia's procurement teams).
export const metadata: Metadata = { title: "Raport de aprovizionare" };

export default async function StocksReportPage({ params }: PageProps<"/[locale]/stocks/report">) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The report reads ?path= on the client, so the page itself stays static.
  return (
    <Suspense>
      <StocksReport />
    </Suspense>
  );
}
