import assert from 'node:assert/strict';
import test from 'node:test';
import { bindFrameAncestors } from '../../apps/editor/shared/frame-policy.mjs';

test('CODE document CSP admits only the exact bound workspace and wrapper', () => {
    const before = "default-src 'self'; frame-ancestors office-wopi.apps.verentis.dev:*; connect-src 'self'";
    assert.equal(bindFrameAncestors(before, 'https://customer.example', 'https://office.apps.verentis.dev'),
        "default-src 'self';frame-ancestors https://office.apps.verentis.dev https://customer.example; connect-src 'self'");
    assert.equal(bindFrameAncestors(before, 'https://another.example', 'https://office.apps.verentis.dev'),
        "default-src 'self';frame-ancestors https://office.apps.verentis.dev https://another.example; connect-src 'self'");
});

test('pinned CODE response format keeps non-framing directives intact', () => {
    const policy = "media-src  'self' blob: http://127.0.0.1:19983; object-src  'self'; style-src  'self'; script-src  'self' 'unsafe-eval'; frame-ancestors  127.0.0.1:* office-wopi.apps.verentis.dev:*; img-src  'self' data: https://www.collaboraoffice.com 127.0.0.1:* office-wopi.apps.verentis.dev:*; connect-src  'self' https://www.zotero.org https://api.zotero.org ws://127.0.0.1:19983 http://127.0.0.1:19983; frame-src  'self' https://rating.collaboraonline.com https://rating.collaboraonline.com blob:; font-src  'self'; default-src  'none'; ";
    const result = bindFrameAncestors(policy, 'https://customer.example', 'https://office.apps.verentis.dev');
    assert.match(result, /frame-ancestors https:\/\/office\.apps\.verentis\.dev https:\/\/customer\.example;/);
    assert.doesNotMatch(result, /frame-ancestors\s+127\.0\.0\.1/);
    for (const directive of ["media-src  'self' blob: http://127.0.0.1:19983",
        "img-src  'self' data: https://www.collaboraoffice.com 127.0.0.1:* office-wopi.apps.verentis.dev:*",
        "default-src  'none'"])
        assert.ok(result.includes(directive));
});

test('missing, ambiguous and malformed CODE framing policies fail closed', () => {
    for (const policy of [null, '', "default-src 'self'", 'frame-ancestors a; frame-ancestors b',
        'frame-ancestors a, frame-ancestors b'])
        assert.throws(() => bindFrameAncestors(policy, 'https://customer.example', 'https://office.apps.verentis.dev'));
    for (const parent of ['null', 'http://customer.example', 'https://customer.example/path',
        'https://*.example', 'https://customer.example/'])
        assert.throws(() => bindFrameAncestors('frame-ancestors a', parent, 'https://office.apps.verentis.dev'));
});
