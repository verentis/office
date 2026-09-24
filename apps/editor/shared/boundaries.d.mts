export interface Launch {
    action: string;
    accessToken: string;
    accessTokenTtl: number;
    fileId: string;
    format: string;
    editorOrigin: string;
    wopiSource: string;
    syntheticOnly: true;
}
export function isTrustedMessage(event: MessageEvent, source: Window | null, origin: string): boolean;
export function parseParentOrigins(configuredOrigins: string): string[];
export function isTrustedParentMessage(event: MessageEvent, source: Window | null, origins: string[], pinnedOrigin: string): boolean;
export function isPotentialParentMessage(event: MessageEvent, source: Window | null, pinnedOrigin: string): boolean;
export function childMessage(event: MessageEvent, source: Window | null, origin: string): { MessageId: string; Values?: Record<string, unknown> } | null;
export function validateLaunch(value: unknown, editorOrigin: string, wopiOrigin: string): Launch;
export function nextDirty(current: boolean, message: { MessageId: string; Values?: Record<string, unknown> }): boolean;
export interface LiveLaunch extends Omit<Launch, 'syntheticOnly'> {
    syntheticOnly: false;
    sessionId: string;
    statusCredential: string;
    readOnly: boolean;
    name: string;
}
export function validateLiveLaunch(value: unknown, editorOrigin: string, wopiOrigin: string,
    context: { workspace: { id: string }; file?: { nodeId?: string; branch?: string } }): LiveLaunch;
export interface SaveCheckpoint { correlation: string; generation: number; revision?: string; }
export interface SaveStatus { revision: string; sequence: number; state: string; receipt: SaveCheckpoint | null; }
export function saveConfirmed(result: SaveStatus, request: SaveCheckpoint | null, currentGeneration: number, editorModified: boolean): boolean;
