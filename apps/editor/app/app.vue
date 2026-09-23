<script setup lang="ts">
import { Bridge } from '@verentis/sdk';
import { childMessage, isTrustedMessage, nextDirty, validateLaunch, type Launch } from '../shared/boundaries.mjs';

const config = useRuntimeConfig().public;
const synthetic = config.syntheticOnly === true || String(config.syntheticOnly) === 'true';
const status = ref('Loading Office…');
const dirty = ref(false);
const format = ref('docx');
const fileId = ref('');
const launch = ref<Launch | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
const form = ref<HTMLFormElement | null>(null);
const busy = ref(false);
const ready = ref(false);
const expired = ref(false);
const launchFailed = ref(false);
let bridge: Bridge | undefined;
let hostReady = false;
let timeout: ReturnType<typeof setTimeout> | undefined;
let handshakeTimeout: ReturnType<typeof setTimeout> | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;
let saveTimeout: ReturnType<typeof setTimeout> | undefined;

function guardParent(event: MessageEvent) {
    const type = event.data?.type;
    if (type === undefined) return;
    if (typeof type !== 'string' || (type.startsWith('verentis:') &&
        (!isTrustedMessage(event, window.parent, config.parentOrigin) ||
            (type === 'verentis:init' && typeof event.data.context?.workspace?.id !== 'string')))) {
        event.stopImmediatePropagation();
    }
}
function onChild(event: MessageEvent) {
    const message = childMessage(event, frame.value?.contentWindow ?? null, config.editorOrigin);
    if (!message) return;
    dirty.value = nextDirty(dirty.value, message);
    if (hostReady) bridge?.setDirty(dirty.value);
    if (message.MessageId === 'App_LoadingStatus' && message.Values?.Status === 'Document_Loaded') {
        ready.value = true;
        launchFailed.value = false;
        clearTimeout(timeout);
        if (!expired.value) status.value = 'Synthetic editor loaded. Saving is not yet independently verified.';
        frame.value?.contentWindow?.postMessage(JSON.stringify({ MessageId: 'Host_PostmessageReady', SendTime: Date.now(), Values: {} }), config.editorOrigin);
    }
    if (message.MessageId === 'Action_Save_Resp') {
        clearTimeout(saveTimeout);
        if (!expired.value) status.value = message.Values?.success === true
            ? 'CODE acknowledged save; reopen and verify the persisted synthetic content. Dirty warning remains conservative.'
            : 'Save not acknowledged. Preserve edits; check session expiry or revision conflict before reopening.';
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
        bridge = new Bridge();
        bridge.sendReady([]);
        if (!config.parentOrigin) {
            status.value = 'Trusted parent origin is not configured. Handshake acceptance and live integration are disabled.';
            return;
        }
        handshakeTimeout = setTimeout(() => { status.value = 'Host handshake timed out. Live integration remains disabled.'; }, 10000);
        try {
            await bridge.waitForInit();
            clearTimeout(handshakeTimeout);
            hostReady = true;
            bridge.setTitle('Office — integration unavailable');
            bridge.setDirty(dirty.value);
            if (!launch.value) status.value = 'Host connected. Live integration unavailable: delegation, stable branch/file identity and conditional uploads are blocked (gates B–E).';
        } catch {
            status.value = 'Host handshake failed. Live integration remains disabled.';
        }
    } else {
        status.value = synthetic ? 'Synthetic-only harness. No Verentis files or tokens are used.' : 'Live integration unavailable (gates B–E). A trusted workspace host is required.';
    }
});
onBeforeUnmount(() => {
    clearTimeout(timeout);
    clearTimeout(handshakeTimeout);
    clearTimeout(expiry);
    clearTimeout(saveTimeout);
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
        ready.value = false;
        expired.value = false;
        launchFailed.value = false;
        status.value = 'Loading real CODE editor…';
        await nextTick();
        form.value?.submit();
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            if (!ready.value) {
                launchFailed.value = true;
                status.value = 'Editor did not report ready. Check CODE/TLS/discovery; preserve any edits before resetting.';
            }
        }, 60000);
        clearTimeout(expiry);
        expiry = setTimeout(() => {
            expired.value = true;
            clearTimeout(saveTimeout);
            status.value = 'Synthetic session expired. Preserve edits and reopen; authorization is not renewed automatically.';
        }, Math.max(0, launch.value.accessTokenTtl - Date.now()));
    } catch {
        status.value = 'Launch rejected or dependency unavailable. Check the fixture, configured origins and CODE discovery.';
    } finally {
        busy.value = false;
    }
}
function requestSave() {
    if (!ready.value || expired.value) return;
    clearTimeout(saveTimeout);
    status.value = 'Save requested; awaiting CODE acknowledgement. Do not close yet.';
    saveTimeout = setTimeout(() => { status.value = 'Save acknowledgement timed out. Preserve edits; check connection and session before retrying.'; }, 30000);
    frame.value?.contentWindow?.postMessage(JSON.stringify({ MessageId: 'Action_Save', SendTime: Date.now(), Values: { DontTerminateEdit: true, DontSaveIfUnmodified: false, Notify: true } }), config.editorOrigin);
}
function resetFailedLaunch() {
    if (!window.confirm('Discard this editor, including any unsaved or unverified edits, and reset the launch?')) return;
    clearTimeout(timeout);
    clearTimeout(expiry);
    clearTimeout(saveTimeout);
    launch.value = null;
    ready.value = false;
    expired.value = false;
    launchFailed.value = false;
    dirty.value = false;
    if (hostReady) bridge?.setDirty(false);
    status.value = 'Editor discarded by explicit confirmation. You can reopen the existing synthetic file.';
}
</script>

<template>
    <main>
        <header><h1>Verentis Office</h1><strong>Live integration disabled</strong></header>
        <p role="status">{{ status }}</p>
        <p class="warning">Host navigation veto and durable-save acknowledgement are unproved. Keep edits until a fresh reopen confirms persistence.</p>
        <p v-if="dirty" data-testid="dirty">Unsaved or unverified changes — do not discard this editor.</p>
        <p v-if="expired" role="alert">Session expired. Preserve edits; saves are disabled and authorization is not renewed automatically.</p>
        <section v-if="synthetic">
            <h2>Isolated synthetic-file harness</h2>
            <form @submit.prevent="openSynthetic">
                <label>Fixture <select v-model="format" :disabled="Boolean(launch)"><option v-for="ext in ['docx', 'odt', 'xlsx', 'ods', 'pptx', 'odp']" :key="ext">{{ ext }}</option></select></label>
                <label>Existing synthetic file ID (optional) <input v-model="fileId" pattern="[a-f0-9]{32}" :disabled="Boolean(launch)"></label>
                <button :disabled="busy || Boolean(launch)">Open synthetic file</button>
                <button v-if="launch" type="button" :disabled="!ready || expired" @click="requestSave">Request save</button>
                <button v-if="launch && (launchFailed || expired)" type="button" @click="resetFailedLaunch">Discard editor and reset launch</button>
            </form>
            <p v-if="launch">Synthetic file: <code data-testid="file-id">{{ launch.fileId }}</code>. Fresh reopen: use this ID in a new tab.</p>
        </section>
        <template v-if="launch">
            <form ref="form" :action="launch.action" method="post" target="office-code" hidden>
                <input type="hidden" name="access_token" :value="launch.accessToken">
                <input type="hidden" name="access_token_ttl" :value="launch.accessTokenTtl">
            </form>
            <iframe ref="frame" name="office-code" title="Synthetic Collabora editor" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerpolicy="no-referrer" />
        </template>
    </main>
</template>

<style>
body { margin: 0; font: 16px system-ui, sans-serif; background: #f5f7fa; color: #17212e; }
main { padding: 1rem; }
header { display: flex; gap: 2rem; align-items: center; }
h1 { margin: 0; }
strong, .warning { color: #8b3600; }
form { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; }
form[hidden] { display: none; }
label { display: flex; gap: .5rem; align-items: center; }
button, select, input { font: inherit; padding: .4rem; }
iframe { margin-top: 1rem; width: 100%; height: 72vh; border: 1px solid #98a7b8; background: white; }
</style>
