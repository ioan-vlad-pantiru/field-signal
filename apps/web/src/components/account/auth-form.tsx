"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { signIn, signUp } from "@/lib/account";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScreenHeader } from "@/components/ui/screen-header";
import { FormNote, TextField, useErrorText } from "./shared";

/** Sign in by default; "Create account" swaps to the sign-up form. */
export function AuthForm({ back }: { back: ReactNode }) {
  const t = useTranslations("Account");
  const errorText = useErrorText();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const up = mode === "up";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    setBusy(true);
    setError(null);
    try {
      if (up) await signUp({ email, password, name: String(data.get("name") ?? "") || null });
      else await signIn({ email, password });
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  }

  function swap() {
    setMode(up ? "in" : "up");
    setError(null);
  }

  return (
    <>
      <ScreenHeader back={back} title={up ? t("signUpTitle") : t("signInTitle")} meta={t("intro")} />
      <Card>
        {/* key: a fresh form per mode, so the browser offers the right saved password. */}
        <form key={mode} onSubmit={submit} className="flex flex-col gap-4">
          {up ? <TextField label={t("name")} name="name" autoComplete="name" maxLength={80} /> : null}
          <TextField label={t("email")} name="email" type="email" required autoComplete="email" inputMode="email" />
          <TextField
            label={up ? t("newPassword") : t("password")}
            name="password"
            type="password"
            required
            minLength={up ? 8 : 1}
            autoComplete={up ? "new-password" : "current-password"}
          />
          <FormNote error={error} />
          <Button type="submit" size="lg" disabled={busy} className="w-full">
            {busy ? t("working") : up ? t("signUp") : t("signIn")}
          </Button>
        </form>
      </Card>
      <p className="text-center text-ink-muted">
        {up ? t("haveAccount") : t("noAccount")}{" "}
        <button
          type="button"
          onClick={swap}
          className="press inline-flex min-h-tap items-center rounded-pill px-2 font-semibold text-field hover:bg-surface-sunken"
        >
          {up ? t("signIn") : t("signUp")}
        </button>
      </p>
    </>
  );
}
