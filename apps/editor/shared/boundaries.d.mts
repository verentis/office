export interface Launch {
    action: string;
    accessToken: string;
    accessTokenTtl: number;
    fileId: string;
    format: string;
    editorOrigin: string;
    wopiSource: string;
}
export function isTrustedMessage(event: MessageEvent, source: Window | null, origin: string): boolean;
export function parseParentOrigins(configuredOrigins: string): string[];
export function isTrustedParentMessage(event: MessageEvent, source: Window | null, origins: string[], pinnedOrigin: string): boolean;
export function isPotentialParentMessage(event: MessageEvent, source: Window | null, pinnedOrigin: string): boolean;
export function childMessage(event: MessageEvent, source: Window | null, origin: string): { MessageId: string; Values?: Record<string, unknown> } | null;
export function nextDirty(current: boolean, message: { MessageId: string; Values?: Record<string, unknown> }): boolean;
export function isDerivedSaveResponse(message: { MessageId: string; Values?: Record<string, unknown> }): boolean;
export function editorReloadStarted(message: { MessageId: string; Values?: Record<string, unknown> }): boolean;
export function saveAsDraft(name: string, currentFormat: string, requestedFormat: unknown): { filename: string; format: string };
export function saveAsCommand(filename: string, format: string): {
    MessageId: string; SendTime: number; Values: { Filename: string; Notify: boolean };
};
export function sessionStatusProblem(state: string): { terminal: boolean; message: string } | null;
export interface LiveDocument {
    sessionId: string;
    workspaceId: string;
    branch: string;
    nodeId: string;
    readOnly: boolean;
    name: string;
    fileId: string;
    format: string;
    accessTokenTtl: number;
}
export interface LiveLaunch extends Launch, LiveDocument {}
export function validateLiveLaunch(value: unknown, editorOrigin: string, wopiOrigin: string,
    context: { workspace: { id: string }; file?: { nodeId?: string; branch?: string } }): LiveLaunch;
export function validateLiveContinuation(value: unknown, current: LiveDocument): LiveDocument;
export interface SaveCheckpoint { correlation: string; generation: number; revision?: string | null; }
export interface SaveStatus { revision: string; readOnly: boolean; state: string; receipt: SaveCheckpoint | null; continuationAvailable?: boolean; }
export function saveConfirmed(result: SaveStatus, request: SaveCheckpoint | null, currentGeneration: number, editorModified: boolean): boolean;
