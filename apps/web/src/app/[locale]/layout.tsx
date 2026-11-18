import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import Script from "next/script";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Assistant } from "@/components/assistant/assistant";
import { BottomBar } from "@/components/layout/nav";
import { PageTransition } from "@/components/layout/page-transition";
import { ServiceWorkerRegistration } from "@/components/layout/service-worker";
import { SiteHeader } from "@/components/layout/site-header";
import { CF_ANALYTICS_TOKEN } from "@/lib/site";
import "../globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin", "latin-ext"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin", "latin-ext"] });
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "latin-ext"],
});

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "App" });
  return {
    title: { default: t("name"), template: `%s · ${t("name")}` },
    description: t("description"),
    applicationName: t("name"),
    appleWebApp: { capable: true, title: t("name"), statusBarStyle: "default" },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0c110e" },
  ],
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${geist.variable} ${geistMono.variable} ${bricolage.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-[1200px] flex-1 px-gutter pb-[calc(var(--bar-space)+1.5rem)] pt-[max(1rem,env(safe-area-inset-top))] sm:pb-28 sm:pt-6">
            {/* Route changes cross-fade with a small lift; the bars stay put. */}
            <PageTransition>{children}</PageTransition>
          </main>
          <BottomBar />
          <Assistant />
          <ServiceWorkerRegistration />
        </NextIntlClientProvider>
        {/* Cookieless visit counts, production builds only; it follows client-side route changes itself. */}
        {process.env.NODE_ENV === "production" && (
          <Script
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: CF_ANALYTICS_TOKEN })}
          />
        )}
      </body>
    </html>
  );
}
