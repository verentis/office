"""Generate original, minimal synthetic OOXML/ODF fixtures using only the standard library."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED, ZIP_STORED

root = Path(__file__).parent
text = "Synthetic Office fixture"
ns = "http://schemas.openxmlformats.org"

def package(ext, parts, mime=None):
    with ZipFile(root / f"synthetic.{ext}", "w", ZIP_DEFLATED) as archive:
        def write(name, content, compression=ZIP_DEFLATED):
            entry = ZipInfo(name, date_time=(2026, 9, 23, 0, 0, 0))
            entry.compress_type = compression
            archive.writestr(entry, content)
        if mime:
            write("mimetype", mime, ZIP_STORED)
        for name, content in parts.items():
            write(name, content)

def ooxml(ext, main, content_type, parts):
    overrides = "".join(f'<Override PartName="/{name}" ContentType="{ctype}"/>' for name, ctype in content_type.items())
    parts["[Content_Types].xml"] = f'<Types xmlns="{ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>{overrides}</Types>'
    parts["_rels/.rels"] = f'<Relationships xmlns="{ns}/package/2006/relationships"><Relationship Id="r1" Type="{ns}/officeDocument/2006/relationships/officeDocument" Target="{main}"/></Relationships>'
    package(ext, parts)

ooxml("docx", "word/document.xml", {"word/document.xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"}, {
    "word/document.xml": f'<w:document xmlns:w="{ns}/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
})
ooxml("xlsx", "xl/workbook.xml", {
    "xl/workbook.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    "xl/worksheets/sheet1.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
}, {
    "xl/workbook.xml": f'<workbook xmlns="{ns}/spreadsheetml/2006/main" xmlns:r="{ns}/officeDocument/2006/relationships"><sheets><sheet name="Synthetic" sheetId="1" r:id="r1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": f'<Relationships xmlns="{ns}/package/2006/relationships"><Relationship Id="r1" Type="{ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": f'<worksheet xmlns="{ns}/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>{text}</t></is></c></row></sheetData></worksheet>'
})
ooxml("pptx", "ppt/presentation.xml", {
    "ppt/presentation.xml": "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    "ppt/slides/slide1.xml": "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
}, {
    "ppt/presentation.xml": f'<p:presentation xmlns:p="{ns}/presentationml/2006/main" xmlns:r="{ns}/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="r1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    "ppt/_rels/presentation.xml.rels": f'<Relationships xmlns="{ns}/package/2006/relationships"><Relationship Id="r1" Type="{ns}/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    "ppt/slides/slide1.xml": f'<p:sld xmlns:p="{ns}/presentationml/2006/main" xmlns:a="{ns}/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Synthetic"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
})
for ext, kind, body in [
    ("odt", "text", f"<office:text><text:p>{text}</text:p></office:text>"),
    ("ods", "spreadsheet", f'<office:spreadsheet><table:table table:name="Synthetic"><table:table-row><table:table-cell office:value-type="string"><text:p>{text}</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>'),
    ("odp", "presentation", f'<office:presentation><draw:page draw:name="Synthetic"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="5cm"><draw:text-box><text:p>{text}</text:p></draw:text-box></draw:frame></draw:page></office:presentation>')
]:
    mime = f"application/vnd.oasis.opendocument.{kind}"
    package(ext, {
        "content.xml": f'<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3"><office:body>{body}</office:body></office:document-content>',
        "META-INF/manifest.xml": f'<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="{mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>'
    }, mime)
print("Generated six original synthetic fixtures.")
