"use client";

import { useTranslations } from "next-intl";

/** The terms the results use, one line each (shared with About and data). */
export const GLOSSARY_TERMS = ["et", "ndvi", "soilMoisture", "waterBalance", "frost"] as const;

export function Glossary() {
  const t = useTranslations("Glossary");
  return (
    <dl className="flex flex-col gap-3">
      {GLOSSARY_TERMS.map((id) => (
        <div key={id}>
          <dt className="font-semibold">{t(`${id}.term`)}</dt>
          <dd className="text-sm text-ink-muted">{t(`${id}.text`)}</dd>
        </div>
      ))}
    </dl>
  );
}
