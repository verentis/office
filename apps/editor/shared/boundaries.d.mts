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
export function childMessage(event: MessageEvent, source: Window | null, origin: string): { MessageId: string; Values?: Record<string, unknown> } | null;
export function validateLaunch(value: unknown, editorOrigin: string, wopiOrigin: string): Launch;
export function nextDirty(current: boolean, message: { MessageId: string; Values?: Record<string, unknown> }): boolean;
