import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import {
    rawFileUrl, readableKind, sheetHtmlToText, slidesFodpToText, truncate, validWorkspacePath, MAX_TEXT_CHARS
} from '../../apps/editor/shared/agent-read.mjs';

test('reads documents, spreadsheets and presentations, and leaves plain text and drawings alone', () => {
    assert.equal(readableKind('/a/Brief.DOCX'), 'text');
    assert.equal(readableKind('/a/notes.odt'), 'text');
    assert.equal(readableKind('/a/budget.xlsx'), 'sheet');
    assert.equal(readableKind('/a/budget.ods'), 'sheet');
    assert.equal(readableKind('/a/deck.pptx'), 'slides');
    assert.equal(readableKind('/a/deck.odp'), 'slides');
    for (const path of ['/a/readme.md', '/a/notes.txt', '/a/rows.csv', '/a/rows.tsv', '/a/plan.vsdx', '/a/archive', '/a/x.zip'])
        assert.equal(readableKind(path), null, path);
});

test('accepts only absolute workspace paths without traversal', () => {
    assert.ok(validWorkspacePath('/reports/Q1 plan.docx'));
    for (const path of ['reports/q1.docx', '/', '/a/../b.docx', '/a/./b.docx', '/a\\b.docx', '/a\nb.docx', 42, null])
        assert.equal(validWorkspacePath(path), false, String(path));
});

test('downloads only from the platform origin, with each segment encoded', () => {
    const url = rawFileUrl('https://api.example.test', '/Reports/Q1 #1?.docx');
    assert.equal(url.origin, 'https://api.example.test');
    assert.equal(url.pathname, '/v1/files/raw/Reports/Q1%20%231%3F.docx');
    assert.equal(url.searchParams.get('branch'), 'main');
});

test('flattens Calc HTML into sheet headings and tab-separated rows', () => {
    // The shape CODE's convert-to/html returns for a two-sheet workbook.
    const workbook = `<html><head><style>td{}</style></head><body>
        <h1>Overview</h1><a href="#table0"><em>Budget</em></a><a href="#table1"><em>Notes</em></a><hr>
        <A NAME="table0"><h1>Sheet 1: <em>Budget</em></h1></A>
        <table><tr><td>Area</td><td>Spend &amp; tax</td></tr><tr><td>North</td><td sdval="12">12</td></tr>
        <tr><td>&nbsp;</td><td>24</td><td><br></td></tr></table>
        <A NAME="table1"><h1>Sheet 2: <em>Notes</em></h1></A><table><tr><td>Done &lt;ok&gt;&#33;</td></tr></table></body></html>`;
    assert.equal(sheetHtmlToText(workbook), '## Budget\nArea\tSpend & tax\nNorth\t12\n\t24\n\n## Notes\nDone <ok>!');
    // A single sheet has no overview or headings.
    assert.equal(sheetHtmlToText('<table><tr><td>Only</td><td>row</td></tr></table>'), 'Only\trow');
});

test('flattens Impress flat ODP into slides with speaker notes', () => {
    // The shape CODE's convert-to/fodp returns: pretty-printed, with master pages, images and placeholders.
    const fodp = `<office:document><office:master-styles><style:master-page>
        <draw:frame presentation:class="title"><draw:text-box><text:p>Master title</text:p></draw:text-box></draw:frame>
        </style:master-page></office:master-styles><office:body><office:presentation>
        <draw:page draw:name="Season plan">
          <draw:frame presentation:class="title"><draw:text-box>
            <text:p><text:span>Season</text:span><text:s/><text:span>plan</text:span></text:p></draw:text-box></draw:frame>
          <draw:frame presentation:class="outline"><draw:text-box><text:list><text:list-item>
            <text:p><text:span>Plant &amp; water</text:span></text:p></text:list-item></text:list></draw:text-box></draw:frame>
          <draw:frame presentation:class="page-number"><draw:text-box><text:p><text:page-number>3</text:page-number></text:p></draw:text-box></draw:frame>
          <draw:frame><draw:image><office:binary-data>VkNMTVRGAQAx</office:binary-data></draw:image><svg:desc>A logo</svg:desc></draw:frame>
          <presentation:notes><draw:page-thumbnail/><draw:frame presentation:class="notes"><draw:text-box>
            <text:p>Mention the</text:p><text:p>budget</text:p></draw:text-box></draw:frame></presentation:notes>
        </draw:page>
        <draw:page draw:name="page2"><draw:frame><table:table><table:table-row>
          <table:table-cell><text:p>Area</text:p></table:table-cell><table:table-cell><text:p>Spend</text:p><text:p>(R)</text:p></table:table-cell>
          </table:table-row><table:table-row><table:table-cell><text:p>North</text:p></table:table-cell>
          <table:table-cell><text:p>12</text:p></table:table-cell></table:table-row></table:table></draw:frame></draw:page>
        </office:presentation></office:body></office:document>`;
    assert.equal(slidesFodpToText(fodp),
        '## Slide 1\nSeason plan\nPlant & water\nNotes:\nMention the\nbudget\n\n## Slide 2\nArea\tSpend (R)\nNorth\t12');
    assert.equal(slidesFodpToText('<office:document/>'), '');
});

test('caps returned text', () => {
    assert.deepEqual(truncate('short'), { content: 'short', truncated: false });
    const long = truncate('x'.repeat(MAX_TEXT_CHARS + 5));
    assert.equal(long.content.length, MAX_TEXT_CHARS);
    assert.equal(long.truncated, true);
});

test('the manifest wires read_document as the document read tool', () => {
    const { spec } = parse(readFileSync('manifests/office.app.yaml', 'utf8'));
    const tool = spec.tools.find(candidate => candidate.key === 'read_document');
    assert.equal(tool.effect, 'read');
    assert.deepEqual(tool.scopes, ['file.read']);
    assert.deepEqual(tool.implementation, { type: 'app-backend', operation: '/agent/read-document', method: 'POST' });
    const [surface] = spec.actor.surfaces;
    assert.equal(surface.kind, 'document');
    assert.equal(surface['read-tool'], 'read_document');
    for (const extension of surface.extensions)
        assert.ok(readableKind(`/f${extension}`), `${extension} must be readable by the tool`);
});
