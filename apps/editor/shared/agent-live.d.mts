export const LIVE_CHANNEL: string;
export const MAX_INSERT_CHARS: number;
export const MAX_OPERATIONS: number;
export const SELECTION_TIMEOUT_MS: number;
export interface LiveFailure { ok: false; code: string; message: string }
export function liveRequest(payload: unknown, openPath: string | null | undefined):
    { action: 'read' | 'apply'; path: string; operations: unknown; reply?: undefined } | { reply: LiveFailure };
export function insertions(operations: unknown): { texts: string[]; reply?: undefined } | { reply: LiveFailure };
export function selectionReply(path: string, selection: unknown, dirty: boolean): LiveFailure | {
    ok: true; path: string; scope: 'selection'; content: string; truncated: boolean; dirty: boolean; note: string;
};
export function appliedReply(path: string, count: number): { ok: true; path: string; applied: number; saved: false; note: string };
export function unavailableReply(state: { readOnly: boolean; ready: boolean }): LiveFailure;
