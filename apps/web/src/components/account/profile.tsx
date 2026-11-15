"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { signOut } from "@/lib/account";
import type { Account } from "@/lib/contracts";
import { useAppLocale } from "@/lib/localized";
import { Button } from "@/components/ui/button";
import { ListGroup, ListRow } from "@/components/ui/list";
import { DeleteSheet, NameSheet, PasswordSheet } from "./profile-sheets";

type Open = "name" | "password" | "delete" | null;

/** The signed-in account as grouped rows; editing happens in sheets. */
export function Profile({ account, fieldCount }: { account: Account; fieldCount: number }) {
  const t = useTranslations("Account.profile");
  const ta = useTranslations("Account");
  const locale = useAppLocale();
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const since = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(account.created_at));
  const close = () => setOpen(null);

  return (
    <>
      <p role="status" className="-mt-2 px-1 text-sm text-field empty:hidden">
        {notice ?? ""}
      </p>
      <ListGroup>
        <ListRow label={t("name")} detail={account.name || t("nameEmpty")} onClick={() => setOpen("name")} />
        <ListRow label={t("email")} detail={account.email} />
        <ListRow label={t("since")} detail={since} />
      </ListGroup>
      <ListGroup>
        <ListRow label={t("passwordTitle")} onClick={() => setOpen("password")} />
        <ListRow label={<span className="text-status-bad">{t("deleteTitle")}</span>} onClick={() => setOpen("delete")} />
      </ListGroup>
      <Button
        variant="secondary"
        className="w-full"
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true);
          await signOut().catch(() => undefined);
        }}
      >
        {ta("signOut")}
      </Button>

      <NameSheet
        open={open === "name"}
        name={account.name ?? ""}
        onClose={close}
        onDone={() => {
          close();
          setNotice(t("nameSaved"));
        }}
      />
      <PasswordSheet
        open={open === "password"}
        onClose={close}
        onDone={() => {
          close();
          setNotice(t("passwordChanged"));
        }}
      />
      <DeleteSheet open={open === "delete"} fieldCount={fieldCount} onClose={close} />
    </>
  );
}
