"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { PathId } from "@/lib/stocks";
import { Segmented } from "@/components/ui/segmented";
import { FeedView } from "@/components/feed/feed-view";
import { StocksView } from "@/components/stocks/stocks-view";

const VIEWS = ["region", "stocks"] as const;
type View = (typeof VIEWS)[number];

/**
 * The feed buyer's place: where to source (Region) and what is running short (Stocks), behind the
 * screen's one segmented control. `?view=` and `?path=` keep the state in the URL, so the old
 * `/feed` and `/stocks?path=B` links and the stocks report's back link land on the right view.
 */
export function BuyersView() {
  const t = useTranslations("Buyers");
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view: View = params.get("view") === "stocks" ? "stocks" : "region";
  const path: PathId = params.get("path") === "B" ? "B" : "A";

  function update(next: Record<string, string>) {
    const query = { ...Object.fromEntries(params.entries()), ...next };
    router.replace({ pathname, query }, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-5">
      <Segmented
        label={t("viewLabel")}
        value={view}
        onChange={(next) => update({ view: next })}
        options={VIEWS.map((v) => ({ value: v, label: t(v) }))}
        className="w-full sm:w-80"
      />
      {view === "region" ? (
        <FeedView />
      ) : (
        <StocksView key={path} initialPath={path} onPath={(next) => update({ path: next })} />
      )}
    </div>
  );
}
