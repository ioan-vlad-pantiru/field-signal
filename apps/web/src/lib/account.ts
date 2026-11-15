"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Account, LatLon, SavedAnalysis, SavedAnalysisInput, SavedField, SavedFieldInput, SignIn, SignUp } from "@/lib/contracts";

/** A field to save; the API rejects a boundary of fewer than 3 corners. */
export type FieldDraft = Omit<SavedFieldInput, "boundary" | "parts"> & { boundary: LatLon[]; parts?: LatLon[][] };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TIMEOUT_MS = 8000;

/** What went wrong, as a stable code the UI translates (`email_taken`, `wrong_credentials`, ...). */
export class AccountError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      // The session is an httpOnly cookie set by the API.
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: init?.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AccountError("offline", 0);
  }
  if (!response.ok) {
    let code = response.status === 422 ? "invalid" : "server";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") code = body.detail;
    } catch {
      // Keep the status-based code.
    }
    throw new AccountError(code, response.status);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

// --------------------------------------------------------------------------- shared state

export type AccountState =
  | { status: "loading" }
  | { status: "offline" }
  | { status: "signed-out" }
  | { status: "signed-in"; account: Account; fields: SavedField[] };

let state: AccountState = { status: "loading" };
let started = false;
const listeners = new Set<() => void>();
const LOADING: AccountState = { status: "loading" };

function set(next: AccountState) {
  state = next;
  listeners.forEach((notify) => notify());
}

async function load() {
  try {
    const account = await call<Account>("/v1/auth/me");
    const fields = await call<SavedField[]>("/v1/me/fields");
    set({ status: "signed-in", account, fields });
  } catch (error) {
    set({ status: error instanceof AccountError && error.status === 401 ? "signed-out" : "offline" });
  }
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** The signed-in farmer and their fields; loads once per page load, shared by every component. */
export function useAccount(): AccountState {
  useEffect(() => {
    if (!started) {
      started = true;
      void load();
    }
  }, []);
  return useSyncExternalStore(subscribe, () => state, () => LOADING);
}

/** Try again after the API was unreachable. */
export function reloadAccount() {
  set({ status: "loading" });
  void load();
}

function fieldsOf(): SavedField[] {
  return state.status === "signed-in" ? state.fields : [];
}

function withFields(fields: SavedField[]) {
  if (state.status === "signed-in") set({ ...state, fields });
}

// --------------------------------------------------------------------------- actions

export async function signUp(body: SignUp) {
  await call<Account>("/v1/auth/signup", { method: "POST", body: JSON.stringify(body) });
  await load();
}

export async function signIn(body: SignIn) {
  await call<Account>("/v1/auth/login", { method: "POST", body: JSON.stringify(body) });
  await load();
}

export async function signOut() {
  try {
    await call<void>("/v1/auth/logout", { method: "POST" });
  } finally {
    set({ status: "signed-out" });
  }
}

export async function createField(body: FieldDraft): Promise<SavedField> {
  const field = await call<SavedField>("/v1/me/fields", { method: "POST", body: JSON.stringify(body) });
  withFields([field, ...fieldsOf()]);
  return field;
}

export async function updateField(id: string, body: FieldDraft): Promise<SavedField> {
  const field = await call<SavedField>(`/v1/me/fields/${id}`, { method: "PUT", body: JSON.stringify(body) });
  withFields([field, ...fieldsOf().filter((f) => f.id !== id)]);
  return field;
}

/** Keeps a field's latest analysis in the account; the field's card then shows it on every device. */
export async function saveAnalysis(id: string, body: SavedAnalysisInput): Promise<SavedField> {
  const field = await call<SavedField>(`/v1/me/fields/${id}/analysis`, {
    method: "PUT",
    body: JSON.stringify(body),
    // An analysis is tens of kilobytes; give a slow phone connection more time than the default.
    signal: AbortSignal.timeout(TIMEOUT_MS * 3),
  });
  withFields(fieldsOf().map((f) => (f.id === id ? field : f)));
  return field;
}

/** The field's saved analysis, in full. */
export function loadAnalysis(id: string): Promise<SavedAnalysis> {
  return call<SavedAnalysis>(`/v1/me/fields/${id}/analysis`, { signal: AbortSignal.timeout(TIMEOUT_MS * 3) });
}

export async function deleteField(id: string) {
  await call<void>(`/v1/me/fields/${id}`, { method: "DELETE" });
  withFields(fieldsOf().filter((f) => f.id !== id));
}

export async function updateProfile(name: string | null) {
  const account = await call<Account>("/v1/auth/me", { method: "PATCH", body: JSON.stringify({ name }) });
  if (state.status === "signed-in") set({ ...state, account });
}

/** Sets a new password; other devices are signed out, this one stays signed in. */
export async function changePassword(currentPassword: string, newPassword: string) {
  await call<void>("/v1/auth/password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

/** Deletes the account and every saved field. */
export async function deleteAccount(password: string) {
  await call<void>("/v1/auth/me", { method: "DELETE", body: JSON.stringify({ password }) });
  set({ status: "signed-out" });
}

/** The editable part of a saved field, for a PUT. */
export function fieldInput(field: SavedField): FieldDraft {
  return { name: field.name, request: field.request, boundary: field.boundary, parts: field.parts ?? [], near: field.near ?? null };
}
