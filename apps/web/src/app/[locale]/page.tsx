import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { mockFieldAnalysis } from "@/lib/mocks";
import { buttonClass } from "@/components/ui/button";
import { HeroScene } from "@/components/home/hero-scene";

// The animation replays the demo field's rotation with the fewest bad seasons.
const bad = (s: (typeof mockFieldAnalysis.strategies)[number]) => s.replay.filter((o) => o.status === "bad").length;

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Home");

  const best = [...mockFieldAnalysis.strategies].sort((a, b) => bad(a) - bad(b) || b.score.total - a.score.total)[0];
  // Four years on screen; barley stands in for the vetch cover crop in the demo.
  const sequence = best.sequence.slice(0, 4).map((c) => (c === "cover_vetch" ? "barley" : c));

  return (
    <section className="relative isolate flex h-[calc(100svh-4rem-max(1rem,env(safe-area-inset-top))-var(--bar-space)-1.5rem)] flex-col justify-end overflow-hidden rounded-2xl bg-[#0b120e] sm:h-[calc(100svh-4rem-1.5rem-7rem)]">
      <Image
        src="/hero-transylvania.webp"
        alt={t("imageAlt")}
        fill
        priority
        sizes="(min-width: 1200px) 1168px, 100vw"
        className="-z-10 object-cover"
      />
      <HeroScene sequence={sequence} firstYear={mockFieldAnalysis.period_end + 2} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/35 to-transparent sm:bg-gradient-to-tr sm:from-black/75 sm:via-black/20" />
      <div className="flex max-w-3xl flex-col gap-4 p-5 text-white sm:p-10">
        <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{t("title")}</h1>
        <p className="max-w-xl text-base text-white/90 sm:text-lg">{t("subtitle")}</p>
        <Link href="/field" className={buttonClass("primary", "lg", "mt-2 self-start")}>
          {t("start")}
        </Link>
      </div>
    </section>
  );
}
