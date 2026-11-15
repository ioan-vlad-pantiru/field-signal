"use client";

import { useTranslations } from "next-intl";
import { useAccount } from "@/lib/account";
import { openAssistant } from "@/lib/assistant";
import { BookIcon, ChatIcon, GlobeIcon, UserIcon } from "@/components/ui/icons";
import { ListGroup, ListRow } from "@/components/ui/list";
import { ScreenHeader } from "@/components/ui/screen-header";
import { LanguageSwitch } from "@/components/layout/nav";

/** Account, about and data, language, and the assistant: what is used now and then. */
export function MoreView() {
  const t = useTranslations("More");
  const account = useAccount();
  const signedIn = account.status === "signed-in";
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <ScreenHeader title={t("title")} />
      <ListGroup>
        <ListRow
          icon={<UserIcon size={18} />}
          label={signedIn ? account.account.name || t("account") : t("signIn")}
          detail={signedIn ? account.account.email : t("signInDetail")}
          href="/more/account"
        />
      </ListGroup>
      <ListGroup>
        <ListRow icon={<BookIcon size={18} />} label={t("about")} detail={t("aboutDetail")} href="/more/about" />
        <ListRow icon={<ChatIcon size={18} />} label={t("ask")} detail={t("askDetail")} onClick={openAssistant} />
        <li className="flex min-h-14 items-center gap-3 px-4 py-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-field-soft text-field-strong">
            <GlobeIcon size={18} />
          </span>
          <span className="flex-1 font-semibold">{t("language")}</span>
          <LanguageSwitch />
        </li>
      </ListGroup>
      <p className="px-1 text-center text-sm text-ink-muted">{t("credit")}</p>
    </div>
  );
}
