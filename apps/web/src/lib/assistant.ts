"use client";

import { useSyncExternalStore } from "react";
import type { AssistantField, AssistantRequest, ChatTurn } from "@/lib/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface Message extends ChatTurn {
  toolsUsed?: string[];
  demoData?: boolean;
  /** Still arriving: the answer streams in word by word. */
  streaming?: boolean;
  /** What the assistant is doing before the words arrive: a tool name, or "reasoning". */
  activity?: string | null;
}

interface State {
  messages: Message[];
  /** Fields the page is showing, so the assistant can analyse them by name. */
  fields: AssistantField[];
}

let state: State = { messages: [], fields: [] };
const listeners = new Set<() => void>();
const EMPTY: State = { messages: [], fields: [] };

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** The conversation and page context; kept across client navigation, gone on reload. */
export function useAssistant(): State {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

export function setAssistantFields(fields: AssistantField[]) {
  set({ fields });
}

export function resetConversation() {
  set({ messages: [] });
}

export class AssistantError extends Error {
  constructor(readonly code: "off" | "failed" | "offline") {
    super(code);
  }
}

function updateAnswer(change: (m: Message) => Message) {
  const last = state.messages.at(-1);
  if (last?.role !== "assistant") return;
  set({ messages: [...state.messages.slice(0, -1), change(last)] });
}

interface StreamEvent {
  type: "delta" | "reset" | "tool" | "reasoning" | "done" | "error";
  text?: string;
  name?: string;
  tools_used?: string[];
  demo_data?: boolean;
}

/**
 * Sends the question with the conversation so far and streams the answer into the store
 * (server-sent events from /v1/assistant/stream). Throws before any answer text on failure.
 */
export async function ask(question: string, options: { lang: "ro" | "en"; page: string; think: boolean }) {
  const history = [...state.messages, { role: "user" as const, content: question }];
  set({ messages: history });
  const body: AssistantRequest = {
    // The generated types spell max lengths as tuples; the API enforces them (24 turns, 10 fields).
    messages: history.slice(-24).map(({ role, content }) => ({ role, content })) as AssistantRequest["messages"],
    lang: options.lang,
    fields: state.fields.slice(0, 10) as AssistantRequest["fields"],
    page: options.page,
    think: options.think,
  };
  let response: Response;
  try {
    response = await fetch(`${API_URL}/v1/assistant/stream`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.think ? 180_000 : 90_000),
    });
  } catch {
    throw new AssistantError("offline");
  }
  if (!response.ok || !response.body) throw new AssistantError(response.status === 503 ? "off" : "failed");

  set({ messages: [...state.messages, { role: "assistant", content: "", streaming: true, activity: null }] });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = false;
  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const event = JSON.parse(line.slice(5)) as StreamEvent;
        if (event.type === "delta") updateAnswer((m) => ({ ...m, content: m.content + (event.text ?? ""), activity: null }));
        else if (event.type === "reset") updateAnswer((m) => ({ ...m, content: "" }));
        else if (event.type === "tool") updateAnswer((m) => ({ ...m, activity: event.name ?? null }));
        else if (event.type === "reasoning") updateAnswer((m) => ({ ...m, activity: "reasoning" }));
        else if (event.type === "error") throw new AssistantError("failed");
        else if (event.type === "done") {
          finished = true;
          updateAnswer((m) => ({
            ...m,
            streaming: false,
            activity: null,
            toolsUsed: event.tools_used,
            demoData: event.demo_data,
          }));
        }
      }
    }
  } catch (error) {
    const partial = state.messages.at(-1);
    // Keep what already arrived; with nothing yet, let the caller offer a retry.
    if (partial?.role === "assistant" && partial.content) {
      updateAnswer((m) => ({ ...m, streaming: false, activity: null }));
      return;
    }
    if (partial?.role === "assistant") set({ messages: state.messages.slice(0, -1) });
    throw error instanceof AssistantError ? error : new AssistantError("failed");
  } finally {
    reader.releaseLock();
  }
  const last = state.messages.at(-1);
  if (last?.role === "assistant" && last.streaming) {
    if (!last.content) {
      set({ messages: state.messages.slice(0, -1) });
      throw new AssistantError("failed");
    }
    updateAnswer((m) => ({ ...m, streaming: false, activity: null }));
  }
}

/** Drops the last question after a failed answer, so it can be asked again. */
export function dropLastQuestion() {
  const last = state.messages.at(-1);
  if (last?.role === "user") set({ messages: state.messages.slice(0, -1) });
}

/** Window event that opens the assistant panel. */
export const OPEN_ASSISTANT_EVENT = "field-signal:open-assistant";

export function openAssistant() {
  window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT));
}
