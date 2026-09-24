import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parse, stringify } from 'yaml';
import formats from '../apps/editor/shared/formats.json' with { type: 'json' };

const bindings = new Map(), fileTypes = new Map();
for (const [extension, format] of Object.entries(formats)) {
    const priority = ['txt', 'md'].includes(extension) ? 50 : 150;
    for (const pattern of format.mimeTypes) {
        const existing = bindings.get(pattern);
        bindings.set(pattern, { pattern, mode: existing?.mode === 'edit' ? 'edit' : format.mode, priority, icon: format.icon });
    }
    const pattern = format.mimeTypes[0];
    const fileType = fileTypes.get(pattern) ?? { pattern, extensions: [], priority, icon: format.icon };
    fileType.extensions.push(`.${extension}`);
    fileTypes.set(pattern, fileType);
}
const path = 'manifests/environments/local.yaml';
const manifest = parse(readFileSync(path, 'utf8'));
const expected = { 'mime-types': [...bindings.values()], 'file-types': [...fileTypes.values()] };
if (process.argv.includes('--check')) {
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(manifest.spec[key], value, `${path}: run npm run sync:formats`);
} else {
    Object.assign(manifest.spec, expected);
    writeFileSync(path, stringify(manifest));
}
