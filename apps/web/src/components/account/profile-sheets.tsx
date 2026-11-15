"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { changePassword, deleteAccount, updateProfile } from "@/lib/account";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { FormNote, TextField, useErrorText } from "./shared";

/** A sheet holding one form, its submit button pinned in the footer. */
function FormSheet({
  open,
  title,
  subtitle,
  submit,
  danger = false,
  onSubmit,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  submit: { label: string; busy: boolean };
  danger?: boolean;
  onSubmit: (form: HTMLFormElement) => Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  const formId = useId();
  const t = useTranslations("Account.profile");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={submit.busy}
            variant={danger ? "danger" : "primary"}
            className="flex-1"
          >
            {submit.label}
          </Button>
        </div>
      }
    >
      {/* Remounted on every open, so fields and errors start empty. */}
      {open ? (
        <form
          id={formId}
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void onSubmit(event.currentTarget);
          }}
          className="flex flex-col gap-4 pt-1"
        >
          {children}
        </form>
      ) : null}
    </Sheet>
  );
}

/** Runs a form action with busy and error state. */
function useAction() {
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>, onDone?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone?.();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, reset: () => setError(null) };
}

const value = (form: HTMLFormElement, key: string) => String(new FormData(form).get(key) ?? "");

export function NameSheet({ open, name, onClose, onDone }: { open: boolean; name: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("Account.profile");
  const action = useAction();
  const close = () => {
    action.reset();
    onClose();
  };
  return (
    <FormSheet
      open={open}
      title={t("name")}
      submit={{ label: t("saveName"), busy: action.busy }}
      onClose={close}
      onSubmit={(form) => action.run(() => updateProfile(value(form, "name").trim() || null), onDone)}
    >
      <TextField label={t("name")} name="name" defaultValue={name} maxLength={80} autoComplete="name" data-autofocus />
      <FormNote error={action.error} />
    </FormSheet>
  );
}

export function PasswordSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("Account.profile");
  const action = useAction();
  const close = () => {
    action.reset();
    onClose();
  };
  return (
    <FormSheet
      open={open}
      title={t("passwordTitle")}
      submit={{ label: t("changePassword"), busy: action.busy }}
      onClose={close}
      onSubmit={(form) => action.run(() => changePassword(value(form, "current"), value(form, "next")), onDone)}
    >
      <TextField label={t("currentPassword")} name="current" type="password" required autoComplete="current-password" />
      <TextField label={t("newPassword")} name="next" type="password" required minLength={8} autoComplete="new-password" />
      <FormNote error={action.error} />
    </FormSheet>
  );
}

export function DeleteSheet({ open, fieldCount, onClose }: { open: boolean; fieldCount: number; onClose: () => void }) {
  const t = useTranslations("Account.profile");
  const action = useAction();
  const close = () => {
    action.reset();
    onClose();
  };
  return (
    <FormSheet
      open={open}
      title={t("deleteTitle")}
      subtitle={t("deleteText", { count: fieldCount })}
      submit={{ label: t("deleteConfirm"), busy: action.busy }}
      danger
      onClose={close}
      // On success the account store signs out, and the page shows the sign-in form.
      onSubmit={(form) => action.run(() => deleteAccount(value(form, "password")))}
    >
      <TextField label={t("deletePassword")} name="password" type="password" required autoComplete="current-password" />
      <FormNote error={action.error} />
    </FormSheet>
  );
}
