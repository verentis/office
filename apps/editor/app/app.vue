<script setup lang="ts">
import { Bridge, type HeaderActionRegistration } from '@verentis/sdk';
import { childMessage, isTrustedParentMessage, isPotentialParentMessage, parseParentOrigins, nextDirty, validateLaunch, validateLiveLaunch, saveConfirmed,
    type Launch, type LiveLaunch, type SaveCheckpoint, type SaveStatus } from '../shared/boundaries.mjs';

const config = useRuntimeConfig().public;
const synthetic = config.syntheticOnly === true || String(config.syntheticOnly) === 'true';
const status = ref('Loading Office…');
const dirty = ref(false);
const format = ref('docx');
const fileId = ref('');
const launch = ref<Launch | LiveLaunch | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
const form = ref<HTMLFormElement | null>(null);
const busy = ref(false);
const ready = ref(false);
const expired = ref(false);
const launchFailed = ref(false);
const saving = ref(false);
const needsAttention = ref(false);
const showDetails = ref(false);
const canSave = computed(() => ready.value && !expired.value && !saving.value &&
    !(launch.value?.syntheticOnly === false && launch.value.readOnly));
let bridge: Bridge | undefined;
let saveAction: HeaderActionRegistration | undefined;
let hostReady = false;
let timeout: ReturnType<typeof setTimeout> | undefined;
let handshakeTimeout: ReturnType<typeof setTimeout> | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;
let saveTimeout: ReturnType<typeof setTimeout> | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let editGeneration = 0;
let requestedGeneration = 0;
let requestedSave: SaveCheckpoint | null = null;
let editorModified = false;
let destroyed = false;
let parentOrigin = '';
let parentOrigins: string[] = [];

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
        (!(synthetic
            ? isTrustedParentMessage(event, window.parent, parentOrigins, parentOrigin)
            : isPotentialParentMessage(event, window.parent, parentOrigin)) ||
            (type === 'verentis:init' && typeof event.data.context?.workspace?.id !== 'string')))) {
        event.stopImmediatePropagation();
    } else if (type === 'verentis:init') {
        parentOrigin = event.origin;
    }
}
function onChild(event: MessageEvent) {
    const message = childMessage(event, frame.value?.contentWindow ?? null, config.editorOrigin);
    if (!message) return;
    if (message.MessageId === 'Doc_ModifiedStatus' && typeof message.Values?.Modified === 'boolean')
        editorModified = message.Values.Modified;
    if (message.MessageId === 'Doc_ModifiedStatus' && message.Values?.Modified === true) editGeneration++;
    dirty.value = nextDirty(dirty.value, message);
    if (hostReady) bridge?.setDirty(dirty.value);
    if (message.MessageId === 'App_LoadingStatus' && message.Values?.Status === 'Document_Loaded') {
        ready.value = true;
        launchFailed.value = false;
        needsAttention.value = false;
        clearTimeout(timeout);
        if (!expired.value) status.value = synthetic
            ? 'Synthetic editor loaded. Saving is not yet independently verified.'
            : launch.value?.syntheticOnly === false && launch.value.readOnly ? 'Verentis file opened read-only.' : 'Verentis file opened. Saves use conditional platform writes.';
        frame.value?.contentWindow?.postMessage(JSON.stringify({ MessageId: 'Host_PostmessageReady', SendTime: Date.now(), Values: {} }), config.editorOrigin);
    }
    if (message.MessageId === 'Action_Save_Resp') {
        if (synthetic) {
            clearTimeout(saveTimeout);
            saving.value = false;
        }
        if (!expired.value && (dirty.value || synthetic)) status.value = message.Values?.success === true
            ? `CODE acknowledged save request for edit generation ${requestedGeneration}. Awaiting durable status; keep unverified edits open.`
            : 'Save not acknowledged. Preserve edits; check session expiry or revision conflict before reopening.';
        if (message.Values?.success !== true) needsAttention.value = true;
    }
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
            if (synthetic) parentOrigins = parseParentOrigins(config.parentOrigins || config.parentOrigin);
            // The capture-phase guard authenticates and pins init before the
            // SDK sees it, including hosts with a no-referrer policy.
            bridge = new Bridge(synthetic && parentOrigins.length === 1 ? parentOrigins[0] : undefined);
            bridge.sendReady([]);
            const initialized = await Promise.race([
                bridge.waitForInit(),
                new Promise<never>((_, reject) => { handshakeTimeout = setTimeout(() => reject(new Error('Host handshake timed out.')), 10000); })
            ]);
            clearTimeout(handshakeTimeout);
            hostReady = true;
            bridge.setTitle('Office');
            bridge.setDirty(dirty.value);
            if (!synthetic) {
                saveAction = bridge.registerAction({
                    id: 'office.save', label: 'Save', icon: 'lucide:save', scopes: [], enabled: false,
                }, requestSave);
                bridge.registerAction({
                    id: 'office.status', label: 'Office status', icon: 'lucide:info', scopes: [],
                }, () => { showDetails.value = !showDetails.value; });
                status.value = 'Authorizing the installed backend for this file…';
                const credential = await bridge.requestBackendCredential();
                const response = await $fetch('/api/sessions', {
                    method: 'POST', body: { ...credential, parentOrigin }
                });
                if (destroyed) return;
                launch.value = validateLiveLaunch(response, config.editorOrigin, config.wopiOrigin, initialized.context);
                bridge.setTitle(`Office — ${launch.value.name}`);
                await startEditor();
                void pollStatus();
            }
        } catch {
            reportProblem('Office could not authorize this file. Check browser login, backend registration, installation consent/pairing, branch and trusted origins.');
        }
    } else {
        status.value = synthetic ? 'Synthetic-only harness. No Verentis files or tokens are used.' : 'Open an existing file through its authorized Verentis workspace.';
    }
});
onBeforeUnmount(() => {
    destroyed = true;
    clearTimeout(timeout);
    clearTimeout(handshakeTimeout);
    clearTimeout(expiry);
    clearTimeout(saveTimeout);
    clearTimeout(statusTimer);
    bridge?.destroy();
    window.removeEventListener('message', guardParent, true);
    window.removeEventListener('message', onChild);
    window.removeEventListener('beforeunload', beforeUnload);
});
async function openSynthetic() {
    if (launch.value) return;
    busy.value = true;
    try {
        const response = await $fetch('/api/test/sessions', { method: 'POST', body: { format: format.value, fileId: fileId.value || null } });
        launch.value = validateLaunch(response, config.editorOrigin, config.wopiOrigin);
        fileId.value = launch.value.fileId;
        await startEditor();
    } catch {
        status.value = 'Launch rejected or dependency unavailable. Check the fixture, configured origins and CODE discovery.';
    } finally {
        busy.value = false;
    }
}
async function startEditor() {
    if (!launch.value) return;
    ready.value = false;
    expired.value = false;
    launchFailed.value = false;
    needsAttention.value = false;
    status.value = 'Loading CODE editor…';
    await nextTick();
    form.value?.submit();
    clearTimeout(timeout);
    timeout = setTimeout(() => {
        if (!ready.value) {
            launchFailed.value = true;
            reportProblem('Editor did not report ready. Check CODE/TLS/discovery; preserve edits before resetting.');
        }
    }, 60000);
    clearTimeout(expiry);
    expiry = setTimeout(() => {
        expired.value = true;
        reportProblem('The session reached its absolute expiry. Preserve edits and reopen through the workspace.');
    }, Math.max(0, launch.value.accessTokenTtl - Date.now()));
}
async function pollStatus() {
    const current = launch.value;
    if (!current || current.syntheticOnly || expired.value) return;
    try {
        const result = await $fetch<SaveStatus>(
            `/api/sessions/${current.sessionId}/status`,
            { headers: { Authorization: `Bearer ${current.statusCredential}` } });
        if (launch.value !== current) return;
        if (result.state !== 'ready') {
            reportProblem('Another revision or unresolved save requires recovery. Preserve edits; no overwrite was forced.');
        } else if (saveConfirmed(result, requestedSave, editGeneration, editorModified)) {
            dirty.value = false;
            saving.value = false;
            requestedSave = null;
            clearTimeout(saveTimeout);
            if (hostReady) bridge?.setDirty(false);
            needsAttention.value = false;
            status.value = `Saved to Verentis. Confirmed revision ${result.revision}.`;
        } else if (dirty.value && result.sequence > 0) {
            // A durable revision alone cannot identify which browser edit event
            // its snapshot contains. Never clear dirty on an unrelated callback.
            status.value = `Verentis confirmed ${result.sequence} durable save(s). Edit generation ${editGeneration} remains unverified; preserve edits until a fresh reopen confirms them.`;
        }
    } catch {
        reportProblem('Live save status or authorization is unavailable. Preserve unverified edits; do not close.');
    } finally {
        if (!destroyed && launch.value === current && !expired.value) statusTimer = setTimeout(() => void pollStatus(), 3000);
    }
}
async function requestSave() {
    if (!ready.value || expired.value || saving.value || launch.value?.syntheticOnly === false && launch.value.readOnly) return;
    saving.value = true;
    requestedGeneration = editGeneration;
    if (launch.value?.syntheticOnly === false) {
        try {
            requestedSave = await $fetch<SaveCheckpoint>(`/api/sessions/${launch.value.sessionId}/saves`, {
                method: 'POST', body: { generation: requestedGeneration },
                headers: { Authorization: `Bearer ${launch.value.statusCredential}` }
            });
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
    if (launch.value?.syntheticOnly === false) {
        try {
            await $fetch(`/api/sessions/${launch.value.sessionId}`, {
                method: 'DELETE', headers: { Authorization: `Bearer ${launch.value.statusCredential}` }
            });
        } catch {
            reportProblem('Session outcome is unresolved. Preserve edits before attempting another recovery.');
            return;
        }
    }
    clearTimeout(timeout);
    clearTimeout(expiry);
    clearTimeout(saveTimeout);
    clearTimeout(statusTimer);
    launch.value = null;
    ready.value = false;
    expired.value = false;
    launchFailed.value = false;
    saving.value = false;
    requestedSave = null;
    needsAttention.value = false;
    dirty.value = false;
    if (hostReady) bridge?.setDirty(false);
    status.value = 'Editor discarded by explicit confirmation. Reopen the file through the workspace.';
}
</script>

<template>
    <main :class="synthetic ? 'synthetic' : 'live'">
        <header v-if="synthetic"><h1>Verentis Office</h1><strong>Isolated synthetic harness</strong></header>
        <p role="status" :class="{ 'visually-hidden': !synthetic && ready }">{{ status }}</p>
        <p v-if="synthetic" class="warning">Only a matching durable platform receipt can confirm a live save. Unrelated acknowledgements never clear dirty warnings.</p>
        <p v-if="dirty" data-testid="dirty" :class="{ 'visually-hidden': !synthetic }">Unsaved or unverified changes — do not discard this editor.</p>
        <p v-if="synthetic && expired" role="alert">Session expired. Preserve edits; saves are disabled and authorization is not renewed automatically.</p>
        <section v-if="synthetic">
            <h2>Isolated synthetic-file harness</h2>
            <form @submit.prevent="openSynthetic">
                <label>Fixture <select v-model="format" :disabled="Boolean(launch)"><option v-for="ext in ['docx', 'odt', 'xlsx', 'ods', 'pptx', 'odp']" :key="ext">{{ ext }}</option></select></label>
                <label>Existing synthetic file ID (optional) <input v-model="fileId" pattern="[a-f0-9]{32}" :disabled="Boolean(launch)"></label>
                <button :disabled="busy || Boolean(launch)">Open synthetic file</button>
                <button v-if="launch" type="button" :disabled="!ready || expired || saving" @click="requestSave">Request save</button>
                <button v-if="launch && (launchFailed || expired)" type="button" @click="resetFailedLaunch">Discard editor and reset launch</button>
            </form>
            <p v-if="launch">Synthetic file: <code data-testid="file-id">{{ launch.fileId }}</code>. Fresh reopen: use this ID in a new tab.</p>
        </section>
        <template v-if="launch">
            <aside v-if="!synthetic && (needsAttention || showDetails)" class="notice" :role="needsAttention ? 'alert' : 'region'" aria-label="Office status">
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
            <iframe ref="frame" name="office-code" :title="synthetic ? 'Synthetic Collabora editor' : 'Verentis Collabora editor'" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerpolicy="no-referrer" />
        </template>
    </main>
</template>

<style>
body { margin: 0; font: 16px system-ui, sans-serif; background: #f5f7fa; color: #17212e; }
html, body, #__nuxt { width: 100%; height: 100%; }
.live { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; }
.live > iframe { display: block; flex: 1; min-height: 0; width: 100%; margin: 0; border: 0; background: white; }
.live > p:not(.visually-hidden) { padding: 1rem; }
.synthetic { padding: 1rem; }
.synthetic iframe { margin-top: 1rem; width: 100%; height: 72vh; border: 1px solid #98a7b8; background: white; }
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
