"use client";

import { type ReactNode } from "react";
import { ViewTransition } from "react";
import { usePageVisible } from "@/components/simulator/use-media";

/**
 * The route cross-fade. It stays off while the tab is hidden: a view transition started in a
 * hidden document is aborted by the browser, and React reports that abort as an error.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const visible = usePageVisible();
  return <ViewTransition default={visible ? "page" : "none"}>{children}</ViewTransition>;
}
