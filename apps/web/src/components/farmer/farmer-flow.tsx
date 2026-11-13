"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { analyzeField, type Loaded } from "@/lib/api";
import type { FieldAnalysis, FieldRequest } from "@/lib/contracts";
import { ErrorState } from "@/components/ui/states";
import { FieldForm } from "./field-form";
import { ResultsSkeleton, ResultsView } from "./results-view";

type State =
  | { step: "form" }
  | { step: "loading" }
  | { step: "results"; result: Loaded<FieldAnalysis> }
  | { step: "error" };

/** Step 1 (field, rotation, priorities) → step 2 (results), on one route. */
export function FarmerFlow() {
  const t = useTranslations("Field");
  const [state, setState] = useState<State>({ step: "form" });
  const [lastRequest, setLastRequest] = useState<FieldRequest | null>(null);

  async function run(request: FieldRequest) {
    setLastRequest(request);
    setState({ step: "loading" });
    window.scrollTo({ top: 0 });
    try {
      setState({ step: "results", result: await analyzeField(request) });
    } catch {
      setState({ step: "error" });
    }
  }

  function back() {
    setState({ step: "form" });
    window.scrollTo({ top: 0 });
  }

  switch (state.step) {
    case "loading":
      return <ResultsSkeleton />;
    case "error":
      return <ErrorState onRetry={() => (lastRequest ? run(lastRequest) : back())} />;
    case "results":
      return <ResultsView analysis={state.result.data} origin={state.result.origin} onBack={back} />;
    case "form":
      return (
        <div className="flex flex-col gap-4">
          <header>
            <p className="font-medium text-primary">{t("step")}</p>
            <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-lg text-muted">{t("intro")}</p>
          </header>
          <FieldForm initial={lastRequest} onSubmit={run} />
        </div>
      );
  }
}
