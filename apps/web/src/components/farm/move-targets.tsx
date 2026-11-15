"use client";

import { useTranslations } from "next-intl";
import { FIELD_COLOURS, type FieldGroup } from "@/lib/farm";
import { PlusIcon } from "@/components/ui/icons";

/** Where parcels can go: each field (with its map colour) or a new one. One tap moves them. */
export function MoveTargets({
  fields,
  exclude,
  onMove,
}: {
  fields: FieldGroup[];
  /** The field the parcels are already in, left out. */
  exclude?: string | null;
  onMove: (to: string) => void;
}) {
  const t = useTranslations("Farm.move");
  const row =
    "press flex min-h-tap w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left hover:bg-surface-sunken";
  return (
    <ul className="flex flex-col gap-1">
      {fields.map((f, i) =>
        f.id === exclude ? null : (
          <li key={f.id}>
            <button type="button" onClick={() => onMove(f.id)} className={row}>
              <span
                aria-hidden="true"
                className="size-5 shrink-0 rounded-[var(--radius-xs)] ring-1 ring-line"
                style={{ background: FIELD_COLOURS[i % FIELD_COLOURS.length] }}
              />
              <span className="min-w-0 flex-1 truncate font-semibold">{f.name}</span>
            </button>
          </li>
        ),
      )}
      <li>
        <button type="button" onClick={() => onMove("new")} className={`${row} text-field`}>
          <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
            <PlusIcon size={18} />
          </span>
          <span className="font-semibold">{t("new")}</span>
        </button>
      </li>
    </ul>
  );
}
