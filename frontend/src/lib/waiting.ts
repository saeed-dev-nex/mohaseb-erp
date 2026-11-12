import { useSyncExternalStore } from "react";

/**
 * Global "please wait" state for long-running operations (backup,
 * restore, exports, invoice saving…). Call showWaiting() before the await and
 * hideWaiting() in a finally; <WaitingModal/> (mounted once in Layout)
 * renders the blocking overlay. A single shared slot is enough: these
 * operations are user-triggered one at a time.
 */

export type WaitingState = { active: boolean; message: string; since: number };

let state: WaitingState = { active: false, message: "", since: 0 };
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function showWaiting(message: string): void {
  state = { active: true, message, since: Date.now() };
  emit();
}

export function isWaitingActive(): boolean {
  return state.active;
}

export function hideWaiting(): void {
  if (!state.active) return;
  state = { active: false, message: "", since: 0 };
  emit();
}

export function useWaiting(): WaitingState {
  return useSyncExternalStore(subscribe, () => state);
}
