"use client";

import { useTranslations } from "next-intl";
import { reloadAccount, useAccount } from "@/lib/account";
import { Button } from "@/components/ui/button";
import { NoticeBar } from "@/components/ui/notice-bar";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Skeleton } from "@/components/ui/skeleton";
import { BackLink } from "@/components/more/back-link";
import { AuthForm } from "./auth-form";
import { Profile } from "./profile";

// save-field.tsx and save-to-account.tsx import the input style from here.
export { INPUT } from "./shared";

/** More › Account: sign in or up, or the signed-in profile. */
export function AccountView() {
  const t = useTranslations("Account");
  const tMore = useTranslations("More");
  const account = useAccount();
  const back = <BackLink label={tMore("title")} />;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      {account.status === "signed-out" ? (
        <AuthForm back={back} />
      ) : (
        <>
          <ScreenHeader back={back} title={t("title")} />
          {account.status === "loading" ? (
            <div className="flex flex-col gap-3" aria-busy="true" aria-label={t("loading")}>
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : account.status === "offline" ? (
            <div className="flex flex-col items-start gap-3">
              <NoticeBar>{t("offline")}</NoticeBar>
              <Button variant="secondary" onClick={reloadAccount}>
                {t("retry")}
              </Button>
            </div>
          ) : (
            <Profile account={account.account} fieldCount={account.fields.length} />
          )}
        </>
      )}
    </div>
  );
}
