"use client";

import { useMemo, useSyncExternalStore } from "react";
import { EMPTY_VIEW, type View } from "./view";

// Remembered views, in this browser. Storage can be missing or blocked
// (private windows), so writes fall back to memory for the session.
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function readSaved(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeSaved(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* kept in memory only */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** A table's view (sort, group, filters), remembered under a key in this
 *  browser. The server render has no saved view; the browser's is read on
 *  hydration. */
export function useSavedView(key: string): [View, (v: View) => void] {
  const saved = useSyncExternalStore(
    subscribe,
    () => readSaved(key),
    () => null,
  );
  const view = useMemo<View>(() => {
    if (!saved) return EMPTY_VIEW;
    try {
      return JSON.parse(saved) as View;
    } catch {
      return EMPTY_VIEW;
    }
  }, [saved]);
  return [view, (v: View) => writeSaved(key, JSON.stringify(v))];
}
