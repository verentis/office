<script setup lang="ts">
import { Bridge, type HeaderActionRegistration } from '@verentis/sdk';
import { exactHttpsOrigin } from '../shared/frame-policy.mjs';
import { childMessage, isPotentialParentMessage, nextDirty, validateLiveLaunch, validateLiveContinuation,
    isDerivedSaveResponse, editorReloadStarted, saveAsDraft, saveAsCommand, saveConfirmed, sessionStatusProblem,
    type LiveLaunch, type LiveDocument, type SaveCheckpoint } from '../shared/boundaries.mjs';
import { LIVE_CHANNEL, SELECTION_TIMEOUT_MS, liveRequest, insertions, selectionReply, appliedReply,
    unavailableReply } from '../shared/agent-live.mjs';

const config = useRuntimeConfig().public;
const status = ref('Loading Office…');
const dirty = ref(false);
const launch = ref<LiveLaunch | null>(null);
const documentState = ref<LiveDocument | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
const form = ref<HTMLFormElement | null>(null);
const ready = ref(false);
const expired = ref(false);
const saving = ref(false);
const continuationRequired = ref(false);
const continuing = ref(false);
const saveAsOpen = ref(false);
const saveAsPending = ref(false);
const copyName = ref('');
const copyFormat = ref('');
const copyError = ref('');
const copyInput = ref<HTMLInputElement | null>(null);
const statusUnavailable = ref(true);
const statusReadOnly = ref(false);
const needsAttention = ref(false);
const showDetails = ref(false);
const saveAsAuthorized = computed(() => !expired.value && !statusUnavailable.value && !saving.value &&
    !saveAsPending.value && !continuationRequired.value && !continuing.value);
const canSaveAs = computed(() => ready.value && saveAsAuthorized.value);
const canSave = computed(() => canSaveAs.value && !saveAsOpen.value && !documentState.value?.readOnly && !statusReadOnly.value);
let bridge: Bridge | undefined;
let saveAction: HeaderActionRegistration | undefined;
let hostReady = false;
let timeout: ReturnType<typeof setTimeout> | undefined;
let handshakeTimeout: ReturnType<typeof setTimeout> | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;
let saveTimeout: ReturnType<typeof setTimeout> | undefined;
let saveAsTimeout: ReturnType<typeof setTimeout> | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let editGeneration = 0;
let requestedGeneration = 0;
let requestedSave: SaveCheckpoint | null = null;
let saveAttempt = 0;
let statusPolling = false;
let queuedSaveAs: ReturnType<typeof saveAsCommand> | null = null;
let editorModified = false;
let destroyed = false;
let parentOrigin = '';
let openPath = '';
let pendingCopy: ((content: unknown) => void) | undefined;
let copyQueue: Promise<unknown> = Promise.resolve();

function reportProblem(message: string) {
    needsAttention.value = true;
    status.value = message;
}
watch([canSave, saving], () => {
    saveAction?.update({
        id: 'office.save', label: 'Save', icon: 'lucide:save', scopes: [],
        enabled: canSave.value, busy: saving.value,
    });
});
function guardParent(event: MessageEvent) {
    const type = event.data?.type;
    if (type === undefined) return;
    if (typeof type !== 'string' || (type.startsWith('verentis:') &&
        (!isPotentialParentMessage(event, window.parent, parentOrigin) ||
            (type === 'verentis:init' && typeof event.data.context?.workspace?.id !== 'string')))) {
        event.stopImmediatePropagation();
    } else if (type === 'verentis:init') {
        parentOrigin = event.origin;
    }
}
function onChild(event: MessageEvent) {
    const message = childMessage(event, frame.value?.contentWindow ?? null, config.editorOrigin);
    if (!message) return;
    if (message.MessageId === 'Action_Copy_Resp') {
        pendingCopy?.(message.Values?.content);
        return;
    }
    if (editorReloadStarted(message)) {
        ready.value = false;
        saving.value = false;
        requestedSave = null;
        saveAttempt++;
        clearTimeout(saveTimeout);
        if (!expired.value) status.value = 'CODE is reloading the document. Wait for it to finish; preserve unverified edits.';
        waitForEditorLoad();
        return;
    }
    if (message.MessageId === 'UI_SaveAs') {
        void openSaveAs(message.Values?.format);
        return;
    }
    if (message.MessageId === 'Get_Views_Resp' && queuedSaveAs) {
        ready.value = true;
        clearTimeout(timeout);
        const command = queuedSaveAs;
        queuedSaveAs = null;
        if (expired.value || statusUnavailable.value || continuationRequired.value || !frame.value?.contentWindow) {
            saveAsPending.value = false;
            clearTimeout(saveAsTimeout);
            reportProblem('Save As was not sent because authorization changed. Preserve edits and retry when ready.');
            return;
        }
        status.value = 'Save As requested. Keep this editor open while the workspace verifies the target.';
        frame.value.contentWindow.postMessage(JSON.stringify(command), config.editorOrigin);
        return;
    }
    if (isDerivedSaveResponse(message)) {
        queuedSaveAs = null;
        saveAsOpen.value = false;
        continuationRequired.value = true;
        statusUnavailable.value = true;
        dirty.value = true;
        saving.value = false;
        requestedSave = null;
        saveAttempt++;
        clearTimeout(saveTimeout);
        if (hostReady) bridge?.setDirty(true);
        status.value = 'Save As reported by CODE. Verifying the committed target with the workspace…';
        void pollStatus();
        return;
    }
    if (message.MessageId === 'Doc_ModifiedStatus' && typeof message.Values?.Modified === 'boolean')
        editorModified = message.Values.Modified;
    if (message.MessageId === 'Doc_ModifiedStatus' && message.Values?.Modified === true) editGeneration++;
    dirty.value = nextDirty(dirty.value, message);
    if (hostReady) bridge?.setDirty(dirty.value);
    if (message.MessageId === 'App_LoadingStatus' && message.Values?.Status === 'Document_Loaded') {
        ready.value = true;
        needsAttention.value = false;
        clearTimeout(timeout);
        if (!expired.value && !continuationRequired.value) status.value = documentState.value?.readOnly
            ? 'Verentis file opened read-only.' : 'Verentis file opened. Saves use conditional platform writes.';
        frame.value?.contentWindow?.postMessage(JSON.stringify({ MessageId: 'Host_PostmessageReady', SendTime: Date.now(), Values: {} }), config.editorOrigin);
        if (queuedSaveAs) probeSaveAsReadiness();
    }
    if (message.MessageId === 'Action_Save_Resp') {
        if (saveAsPending.value) {
            if (message.Values?.success !== true) {
                saveAsPending.value = false;
                saveAttempt++;
                statusUnavailable.value = true;
                clearTimeout(saveAsTimeout);
                reportProblem('Save As was not acknowledged. Preserve edits; workspace status must be rechecked before retrying.');
                void pollStatus();
            }
            return;
        }
        if (!expired.value && dirty.value) status.value = message.Values?.success === true
            ? `CODE acknowledged save request for edit generation ${requestedGeneration}. Awaiting durable status; keep unverified edits open.`
            : 'Save not acknowledged. Preserve edits; check session expiry or revision conflict before reopening.';
        if (message.Values?.success !== true) needsAttention.value = true;
    }
}
function postToEditor(MessageId: string, Values: Record<string, unknown>) {
    frame.value?.contentWindow?.postMessage(JSON.stringify({ MessageId, SendTime: Date.now(), Values }), config.editorOrigin);
}
// CODE answers Action_Copy with empty content when nothing is selected; the timeout covers a lost answer.
function readSelection(): Promise<unknown> {
    const next = copyQueue.then(() => new Promise<unknown>(resolve => {
        const done = (content: unknown) => { clearTimeout(timer); pendingCopy = undefined; resolve(content); };
        const timer = setTimeout(() => done(null), SELECTION_TIMEOUT_MS);
        pendingCopy = done;
        postToEditor('Action_Copy', { Mimetype: 'text/plain;charset=utf-8' });
    }));
    copyQueue = next.catch(() => undefined);
    return next;
}
// Agent requests on the live channel (spec.actor.live-channel): read the selection, or insert text unsaved.
async function onAgentMessage(payload: unknown) {
    const request = liveRequest(payload, openPath);
    if (request.reply) return request.reply;
    const editable = !documentState.value?.readOnly && !statusReadOnly.value;
    const usable = ready.value && !expired.value && !continuationRequired.value && !continuing.value &&
        !saveAsPending.value && !destroyed && !!frame.value?.contentWindow;
    if (request.action === 'read') {
        if (!usable) return unavailableReply({ readOnly: false, ready: ready.value });
        return selectionReply(request.path, await readSelection(), dirty.value);
    }
    if (!editable || !usable || saving.value) return unavailableReply({ readOnly: !editable, ready: ready.value });
    const planned = insertions(request.operations);
    if (planned.reply) return planned.reply;
    for (const text of planned.texts) postToEditor('Action_Paste', { Mimetype: 'text/plain;charset=utf-8', Data: text });
    return appliedReply(request.path, planned.texts.length);
}
function beforeUnload(event: BeforeUnloadEvent) {
    if (dirty.value) { event.preventDefault(); event.returnValue = ''; }
}
onMounted(async () => {
    window.addEventListener('message', guardParent, true);
    window.addEventListener('message', onChild);
    window.addEventListener('beforeunload', beforeUnload);
    if (window.parent !== window) {
        try {
            // The capture-phase guard authenticates and pins init before the
            // SDK sees it, including hosts with a no-referrer policy.
            parentOrigin = exactHttpsOrigin(document.querySelector('meta[name="verentis-parent-origin"]')?.getAttribute('content') ?? '');
            bridge = new Bridge(parentOrigin);
            bridge.onHostMessage(LIVE_CHANNEL, onAgentMessage);
            bridge.sendReady([]);
            const initialized = await Promise.race([
                bridge.waitForInit(),
                new Promise<never>((_, reject) => { handshakeTimeout = setTimeout(() => reject(new Error('Host handshake timed out.')), 10000); })
            ]);
            clearTimeout(handshakeTimeout);
            hostReady = true;
            openPath = initialized.context.file?.path ?? '';
            bridge.setTitle('Office');
            bridge.setDirty(dirty.value);
            saveAction = bridge.registerAction({
                id: 'office.save', label: 'Save', icon: 'lucide:save', scopes: [], enabled: false,
            }, requestSave);
            bridge.registerAction({
                id: 'office.status', label: 'Office status', icon: 'lucide:info', scopes: [],
            }, () => { showDetails.value = !showDetails.value; });
            status.value = 'Authorizing the approved editor for this file…';
            const response = await bridge.requestWopiLaunch();
            if (destroyed) return;
            launch.value = validateLiveLaunch(response, config.editorOrigin, config.wopiOrigin, initialized.context);
            documentState.value = launch.value;
            bridge.setTitle(`Office — ${launch.value.name}`);
            await startEditor();
            void pollStatus();
        } catch {
            reportProblem('Office could not authorize this file. Check workspace access, signed installation consent, branch and trusted origins.');
        }
    } else {
        status.value = 'Open an existing file through its authorized Verentis workspace.';
    }
});
onBeforeUnmount(() => {
    destroyed = true;
    clearTimeout(timeout);
    clearTimeout(handshakeTimeout);
    clearTimeout(expiry);
    clearTimeout(saveTimeout);
    clearTimeout(saveAsTimeout);
    clearTimeout(statusTimer);
    pendingCopy?.(null);
    bridge?.destroy();
    window.removeEventListener('message', guardParent, true);
    window.removeEventListener('message', onChild);
    window.removeEventListener('beforeunload', beforeUnload);
});
async function startEditor() {
    if (!launch.value) return;
    ready.value = false;
    expired.value = false;
    statusUnavailable.value = true;
    needsAttention.value = false;
    status.value = 'Loading CODE editor…';
    await nextTick();
    form.value?.submit();
    waitForEditorLoad();
    scheduleExpiry();
}
function waitForEditorLoad() {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
        if (!ready.value) {
            reportProblem('Editor did not report ready. Check CODE/TLS/discovery; preserve edits before resetting.');
        }
    }, 60000);
}
function scheduleExpiry() {
    clearTimeout(expiry);
    if (destroyed || !documentState.value) return;
    const remaining = documentState.value.accessTokenTtl - Date.now();
    if (remaining <= 0) {
        expired.value = true;
        queuedSaveAs = null;
        clearTimeout(saveAsTimeout);
        reportProblem('The session reached its absolute expiry. Preserve edits and reopen through the workspace.');
        return;
    }
    expiry = setTimeout(scheduleExpiry, Math.min(remaining, 2_147_483_647));
}
async function pollStatus() {
    const current = documentState.value;
    if (!current || !bridge || expired.value || statusPolling) return;
    statusPolling = true;
    const attempt = saveAttempt;
    clearTimeout(statusTimer);
    try {
        const result = await bridge.getWopiStatus();
        if (documentState.value !== current || saveAttempt !== attempt) return;
        if (result.continuationAvailable || continuationRequired.value) {
            continuationRequired.value = true;
            await continueDerivedLaunch(current);
            return;
        }
        statusUnavailable.value = result.state !== 'ready';
        statusReadOnly.value = result.readOnly === true;
        const problem = sessionStatusProblem(result.state);
        if (problem) {
            if (problem.terminal) {
                expired.value = true;
                queuedSaveAs = null;
                saving.value = false;
                clearTimeout(saveTimeout);
                clearTimeout(saveAsTimeout);
            }
            reportProblem(problem.message);
        } else if (!saveAsPending.value && saveConfirmed(result, requestedSave, editGeneration, editorModified)) {
            dirty.value = false;
            saving.value = false;
            requestedSave = null;
            clearTimeout(saveTimeout);
            if (hostReady) bridge?.setDirty(false);
            needsAttention.value = false;
            status.value = `Saved to Verentis. Confirmed revision ${result.receipt!.revision}.`;
        } else if (statusReadOnly.value && !current.readOnly) {
            reportProblem('Document access is now read-only. Preserve unverified edits.');
        } else if (!saveAsPending.value && dirty.value && result.receipt?.revision) {
            // A durable revision alone cannot identify which browser edit event
            // its snapshot contains. Never clear dirty on an unrelated callback.
            status.value = `Verentis confirmed durable revision ${result.receipt.revision}. Edit generation ${editGeneration} remains unverified; preserve edits until a fresh reopen confirms them.`;
        }
    } catch {
        statusUnavailable.value = true;
        reportProblem('Live save status or authorization is unavailable. Preserve unverified edits; do not close.');
    } finally {
        statusPolling = false;
        if (!destroyed && documentState.value && !expired.value) statusTimer = setTimeout(() => void pollStatus(), 3000);
    }
}

async function continueDerivedLaunch(current: LiveDocument) {
    if (!bridge || continuing.value) return;
    continuing.value = true;
    queuedSaveAs = null;
    statusUnavailable.value = true;
    saving.value = false;
    requestedSave = null;
    saveAttempt++;
    clearTimeout(saveTimeout);
    try {
        const response = await bridge.requestWopiContinuation();
        if (destroyed || documentState.value !== current) return;
        const next = validateLiveContinuation(response, current);
        // The workspace path of a Save As target isn't known here; the agent works with it headlessly.
        if (next.nodeId !== current.nodeId) openPath = '';
        documentState.value = next;
        saveAsOpen.value = false;
        saveAsPending.value = false;
        clearTimeout(saveAsTimeout);
        continuationRequired.value = false;
        expired.value = false;
        statusReadOnly.value = next.readOnly;
        dirty.value = true;
        bridge.setDirty(true);
        bridge.setTitle(`Office — ${next.name}`);
        scheduleExpiry();
        status.value = 'Save As target authorized. Save to confirm any unverified edits.';
    } catch {
        reportProblem('Save As continuation is unavailable. Preserve edits; controls remain blocked until the target is verified.');
    } finally {
        continuing.value = false;
    }
}

async function openSaveAs(format: unknown) {
    if (saveAsOpen.value) return;
    if (!saveAsAuthorized.value || !documentState.value) {
        reportProblem('Save As is unavailable while authorization, a save or continuation is pending. Preserve edits and retry when ready.');
        return;
    }
    try {
        const draft = saveAsDraft(documentState.value.name, documentState.value.format, format);
        copyName.value = draft.filename;
        copyFormat.value = draft.format;
        copyError.value = '';
        saveAsOpen.value = true;
        await nextTick();
        copyInput.value?.focus();
        copyInput.value?.select();
    } catch (error) {
        reportProblem(error instanceof Error ? error.message : 'Save As could not select a supported document format.');
    }
}

function cancelSaveAs() {
    saveAsOpen.value = false;
    copyError.value = '';
    frame.value?.focus();
}

function confirmSaveAs() {
    if (!canSaveAs.value || !frame.value?.contentWindow) {
        copyError.value = 'Save As is unavailable. Preserve edits and check live authorization before retrying.';
        return;
    }
    let command;
    try {
        command = saveAsCommand(copyName.value, copyFormat.value);
    } catch (error) {
        copyError.value = error instanceof Error ? error.message : 'Enter a valid file name.';
        return;
    }
    saveAsOpen.value = false;
    saveAsPending.value = true;
    dirty.value = true;
    requestedSave = null;
    saveAttempt++;
    clearTimeout(saveTimeout);
    if (hostReady) bridge?.setDirty(true);
    queuedSaveAs = command;
    status.value = 'Waiting for CODE to finish loading before Save As. Keep unverified edits open.';
    clearTimeout(saveAsTimeout);
    saveAsTimeout = setTimeout(() => {
        if (queuedSaveAs) {
            queuedSaveAs = null;
            saveAsPending.value = false;
            ready.value = false;
            reportProblem('Save As was not sent because CODE did not report ready. Preserve edits and wait for the document to finish loading.');
        } else {
            reportProblem('Save As confirmation is unavailable. Preserve edits; source controls remain blocked until the target is verified.');
        }
    }, 60000);
    probeSaveAsReadiness();
    frame.value.focus();
}

function probeSaveAsReadiness() {
    // CODE ignores document commands while _appLoaded is false. Get_Views is
    // gated the same way, so its response confirms this editor can accept Save As.
    frame.value?.contentWindow?.postMessage(JSON.stringify({
        MessageId: 'Get_Views', SendTime: Date.now(), Values: {},
    }), config.editorOrigin);
}

async function requestSave() {
    const current = documentState.value;
    if (!canSave.value || !bridge || !current) return;
    saving.value = true;
    const attempt = ++saveAttempt;
    requestedGeneration = editGeneration;
    if (current) {
        try {
            const checkpoint = await bridge.requestWopiSave(requestedGeneration);
            if (destroyed || documentState.value !== current || expired.value || attempt !== saveAttempt) {
                saving.value = false;
                return;
            }
            requestedSave = checkpoint;
        } catch {
            saving.value = false;
            reportProblem('Cannot establish a durable save checkpoint. Preserve edits and check access or revision conflicts.');
            return;
        }
    }
    clearTimeout(saveTimeout);
    status.value = 'Save requested; awaiting CODE acknowledgement. Do not close yet.';
    saveTimeout = setTimeout(() => {
        saving.value = false;
        reportProblem('Save confirmation timed out. Preserve edits; check connection and session before retrying.');
    }, 30000);
    frame.value?.contentWindow?.postMessage(JSON.stringify({
        MessageId: 'Action_Save', SendTime: Date.now(),
        Values: { DontTerminateEdit: true, DontSaveIfUnmodified: false, Notify: true,
            ...(requestedSave ? { ExtendedData: requestedSave.correlation } : {}) }
    }), config.editorOrigin);
}
async function resetFailedLaunch() {
    if (!window.confirm('Discard this editor, including any unsaved or unverified edits, and reset the launch?')) return;
    if (launch.value && bridge) {
        try {
            await bridge.closeWopiSession();
        } catch {
            reportProblem('Session outcome is unresolved. Preserve edits before attempting another recovery.');
            return;
        }
    }
    clearTimeout(timeout);
    clearTimeout(expiry);
    clearTimeout(saveTimeout);
    clearTimeout(statusTimer);
    clearTimeout(saveAsTimeout);
    launch.value = null;
    documentState.value = null;
    queuedSaveAs = null;
    ready.value = false;
    expired.value = false;
    saving.value = false;
    requestedSave = null;
    saveAsOpen.value = false;
    saveAsPending.value = false;
    needsAttention.value = false;
    dirty.value = false;
    if (hostReady) bridge?.setDirty(false);
    status.value = 'Editor discarded by explicit confirmation. Reopen the file through the workspace.';
}
</script>

<template>
    <main class="live">
        <p role="status" :class="{ 'visually-hidden': ready }">{{ status }}</p>
        <p v-if="dirty" data-testid="dirty" class="visually-hidden">Unsaved or unverified changes — do not discard this editor.</p>
        <template v-if="launch">
            <section v-if="saveAsOpen" class="notice" role="dialog" aria-labelledby="office-copy-title" aria-describedby="office-copy-help">
                <h2 id="office-copy-title">Save As</h2>
                <p id="office-copy-help">Save a copy alongside this document. Use a .{{ copyFormat }} file name; the workspace verifies the target and your permissions.</p>
                <form @submit.prevent="confirmSaveAs" @keydown.esc.prevent="cancelSaveAs">
                    <label for="office-copy-name">File name</label>
                    <input id="office-copy-name" ref="copyInput" v-model="copyName" required maxlength="255"
                        :aria-invalid="Boolean(copyError)" :aria-describedby="copyError ? 'office-copy-error' : 'office-copy-help'">
                    <p v-if="copyError" id="office-copy-error" role="alert">{{ copyError }}</p>
                    <p v-if="!canSaveAs" role="alert">Save As is unavailable. {{ status }}</p>
                    <button type="submit" :disabled="!canSaveAs">Confirm Save As</button>
                    <button type="button" @click="cancelSaveAs">Cancel</button>
                </form>
            </section>
            <aside v-if="!saveAsOpen && (needsAttention || showDetails)" class="notice" :role="needsAttention ? 'alert' : 'region'" aria-label="Office status">
                <p>{{ status }}</p>
                <p v-if="dirty">Unsaved or unverified changes — do not discard this editor.</p>
                <button :disabled="!canSave" @click="requestSave">Request save</button>
                <button @click="resetFailedLaunch">Discard editor and close session</button>
                <button v-if="!needsAttention" @click="showDetails = false">Close status</button>
            </aside>
            <form ref="form" :action="launch.action" method="post" target="office-code" hidden>
                <input type="hidden" name="access_token" :value="launch.accessToken">
                <input type="hidden" name="access_token_ttl" :value="launch.accessTokenTtl">
            </form>
            <iframe ref="frame" name="office-code" title="Verentis Collabora editor" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerpolicy="no-referrer" />
        </template>
    </main>
</template>

<style>
body { margin: 0; font: 16px system-ui, sans-serif; background: #f5f7fa; color: #17212e; }
html, body, #__nuxt { width: 100%; height: 100%; }
.live { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; }
.live > iframe { display: block; flex: 1; min-height: 0; width: 100%; margin: 0; border: 0; background: white; }
.live > p:not(.visually-hidden) { padding: 1rem; }
.notice { position: absolute; z-index: 1; top: .5rem; right: .5rem; max-width: min(32rem, calc(100% - 3rem)); padding: 1rem; background: #fff; color: #17212e; border: 1px solid #98a7b8; box-shadow: 0 2px 8px #0003; }
.notice p:first-child { margin-top: 0; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
header { display: flex; gap: 2rem; align-items: center; }
h1 { margin: 0; }
strong, .warning { color: #8b3600; }
form { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; }
form[hidden] { display: none; }
label { display: flex; gap: .5rem; align-items: center; }
button, select, input { font: inherit; padding: .4rem; }
</style>
