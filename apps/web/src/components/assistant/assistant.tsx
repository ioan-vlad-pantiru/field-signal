"use client";

import { Fragment, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { AssistantError, ask, dropLastQuestion, OPEN_ASSISTANT_EVENT, resetConversation, useAssistant, type Message } from "@/lib/assistant";
import { CrossIcon } from "@/components/ui/icons";

/** Inline **bold** only; everything else stays plain text. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** The few shapes the assistant writes: paragraphs, "- " bullets and "1. " lists. */
function Answer({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag
        key={blocks.length}
        start={list.ordered && list.start !== 1 ? list.start : undefined}
        className={`flex flex-col gap-1 pl-5 ${list.ordered ? "list-decimal" : "list-disc"}`}
      >
        {list.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // Blank lines between list items keep the list going.
    if (!line) continue;
    const bullet = /^[-•*]\s+(.*)$/.exec(line);
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(bullet ? bullet[1] : numbered![2]);
      continue;
    }
    // An indented line under a list item continues that item.
    if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line}`;
      continue;
    }
    flush();
    blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ""))}</p>);
  }
  flush();
  return (
    <div className="flex flex-col gap-2">
      {blocks}
      {streaming ? (
        <span aria-hidden="true" className="-mt-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-field motion-reduce:animate-none" />
      ) : null}
    </div>
  );
}

function pageOf(pathname: string): string {
  const first = pathname.split("/").filter(Boolean)[0];
  return first ?? "start";
}

/**
 * "Ask Field Signal": a chat panel on every page, answered by the assistant (Qwen) with the
 * fields on screen and in the account. Non-modal, so the results stay visible beside it.
 */
export function Assistant() {
  const t = useTranslations("Assistant");
  const locale = useLocale();
  const pathname = usePathname();
  const { messages, fields } = useAssistant();
  const [open, setOpen] = useState(false);
  const [think, setThink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // "Ask Field Signal" rows and header actions open the panel from anywhere.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_ASSISTANT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, onOpen);
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function close() {
    setOpen(false);
    launcher.current?.focus();
  }

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setDraft("");
    setError(null);
    setBusy(true);
    try {
      await ask(text, { lang: locale === "en" ? "en" : "ro", page: pageOf(pathname), think });
    } catch (caught) {
      dropLastQuestion();
      setDraft(text);
      setError(t(`errors.${caught instanceof AssistantError ? caught.code : "failed"}`));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  }

  const suggestions = fields.length > 0
    ? [t("suggest.risk"), t("suggest.why"), t("suggest.first"), t("suggest.ndvi")]
    : [t("suggest.how"), t("suggest.ndvi"), t("suggest.data"), t("suggest.feed")];

  if (!open) {
    return (
      <button
        ref={launcher}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("launcher")}
        className="no-print press fixed bottom-[calc(var(--bar-gap)+env(safe-area-inset-bottom))] right-4 z-30 inline-flex size-[var(--bar-h)] items-center justify-center gap-2 rounded-pill bg-field font-semibold text-on-field shadow-float hover:bg-field-strong sm:bottom-6 sm:right-6 sm:size-auto sm:min-h-14 sm:px-5 [html[data-sheets]_&]:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 sm:size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 5h16v11H9l-5 4z" />
          <path d="M8.5 10h.01M12 10h.01M15.5 10h.01" />
        </svg>
        <span className="hidden sm:inline">{t("launcher")}</span>
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
      className="no-print fixed inset-x-0 bottom-0 z-40 flex h-[88dvh] flex-col overflow-hidden rounded-t-[var(--radius-xl)] bg-surface-raised shadow-3 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[min(640px,calc(100svh-7rem))] sm:w-[400px] sm:rounded-[var(--radius-xl)] sm:shadow-float"
    >
      <header className="flex items-center justify-between gap-2 py-3 pl-5 pr-3 shadow-[0_1px_0_var(--line)]">
        <div>
          <h2 id={`${id}-title`} className="font-semibold">
            {t("title")}
          </h2>
          <p className="text-xs text-ink-muted">{t("model")}</p>
        </div>
        <div className="flex items-center">
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                resetConversation();
                setError(null);
              }}
              disabled={busy}
              className="press min-h-tap whitespace-nowrap rounded-pill px-3 text-sm font-semibold text-field hover:bg-surface-sunken disabled:opacity-40"
            >
              {t("newChat")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={close}
            aria-label={t("close")}
            className="press grid size-tap place-items-center rounded-full bg-surface-sunken text-ink-muted hover:text-ink"
          >
            <CrossIcon size={20} />
          </button>
        </div>
      </header>

      <div ref={log} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-ink-muted">{fields.length > 0 ? t("introFields", { count: fields.length }) : t("intro")}</p>
            <ul className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => void send(s)}
                    className="press min-h-tap w-full rounded-[var(--radius-lg)] bg-surface px-4 py-2.5 text-left shadow-1 ring-1 ring-line hover:ring-field"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((m, i) => (
              <MessageItem key={i} message={m} />
            ))}
            {busy && messages.at(-1)?.role === "user" ? (
              <li>
                <Activity label={think ? t("thinking") : t("working")} />
              </li>
            ) : null}
          </ol>
        )}
        {error ? (
          <p role="alert" className="mt-4 rounded-[var(--radius-md)] bg-status-bad-tint px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}
      </div>

      <form onSubmit={submit} className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-1px_0_var(--line)]">
        <label htmlFor={`${id}-q`} className="sr-only">
          {t("placeholder")}
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={`${id}-q`}
            ref={input}
            rows={2}
            value={draft}
            maxLength={2000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            className="min-h-tap flex-1 resize-none rounded-[var(--radius-lg)] bg-surface-sunken px-4 py-2.5 text-base outline-offset-2 placeholder:text-ink-muted focus-visible:outline-3 focus-visible:outline-[var(--focus)]"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="press min-h-tap rounded-pill bg-field px-5 font-semibold text-on-field hover:bg-field-strong disabled:opacity-40"
          >
            {t("send")}
          </button>
        </div>
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={think}
            onChange={(e) => setThink(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--field)]"
          />
          <span>
            <span className="font-semibold">{t("think")}</span> <span className="text-ink-muted">{t("thinkHint")}</span>
          </span>
        </label>
      </form>
    </section>
  );
}

function Activity({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-ink-muted">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="size-1.5 animate-pulse rounded-full bg-field motion-reduce:animate-none"
            style={{ animationDelay: `${d * 150}ms` }}
          />
        ))}
      </span>
      {label}
    </p>
  );
}

function MessageItem({ message }: { message: Message }) {
  const t = useTranslations("Assistant");
  const activity = message.activity
    ? message.activity === "reasoning"
      ? t("thinking")
      : t("lookingAt", { what: t.has(`tools.${message.activity}`) ? t(`tools.${message.activity}`) : message.activity })
    : t("working");
  if (message.role === "user") {
    return (
      <li className="ml-10 self-end rounded-[var(--radius-lg)] rounded-br-[var(--radius-xs)] bg-field-tint px-4 py-2.5">
        <span className="sr-only">{t("you")}: </span>
        {message.content}
      </li>
    );
  }
  const used = [...new Set(message.toolsUsed ?? [])];
  return (
    <li className="flex flex-col gap-2" aria-busy={message.streaming || undefined}>
      {message.content ? <Answer text={message.content} streaming={message.streaming} /> : null}
      {message.streaming && (!message.content || message.activity) ? <Activity label={activity} /> : null}
      {used.length > 0 || message.demoData ? (
        <p className="text-xs text-ink-muted">
          {used.length > 0 ? t("looked", { what: used.map((u) => t(`tools.${u}`)).join(", ") }) : null}
          {used.length > 0 && message.demoData ? " · " : null}
          {message.demoData ? t("demo") : null}
        </p>
      ) : null}
    </li>
  );
}
