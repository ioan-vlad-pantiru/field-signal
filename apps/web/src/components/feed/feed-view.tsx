"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getSourcingRegion, type Loaded } from "@/lib/api";
import type { SourcingRegion } from "@/lib/contracts";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { RegionView } from "./region-view";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; result: Loaded<SourcingRegion> };

/** Buyers › Region: loads the sourcing region (demo data when the API is unreachable), then shows it. */
export function FeedView() {
  const t = useTranslations("Feed");
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getSourcingRegion()
      .then((result) => active && setState({ status: "ready", result }))
      .catch(() => active && setState({ status: "error" }));
    return () => {
      active = false;
    };
  }, [attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {state.status === "loading"
          ? t("loading")
          : state.status === "ready"
            ? t("loaded", { count: state.result.data.zones.length })
            : null}
      </p>
      {state.status === "ready" ? (
        <RegionView result={state.result} />
      ) : (
        <div className="flex flex-col gap-5">
          <ScreenHeader title={t("title")} />
          {state.status === "loading" ? <RegionSkeleton /> : <ErrorState onRetry={retry}>{t("error")}</ErrorState>}
        </div>
      )}
    </>
  );
}

/** The shape of the loaded screen: headline card, crop chips, map row and commune cards. */
function RegionSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden="true">
      <Skeleton className="h-36" />
      <div className="flex gap-2">
        <Skeleton className="h-tap w-24 rounded-pill" />
        <Skeleton className="h-tap w-24 rounded-pill" />
        <Skeleton className="h-tap w-24 rounded-pill" />
      </div>
      <Skeleton className="h-14" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </div>
  );
}
