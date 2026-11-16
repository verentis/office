# Libre Office

Libre Office adds document viewing and editing to your Verentis workspace using self-hosted Collabora. Open supported text documents, spreadsheets and presentations without switching to a desktop office suite.

## What you can do

- Revise a written brief in the document editor.
- Work with spreadsheet cells and formulas.
- Update a presentation in the slide editor.
- Let the workspace AI agent read text documents, spreadsheets and presentations, even when they aren't open.
- While you have a document open, let the agent read the text you've selected and insert text at your cursor for you to review and save.

## Before you install

Your platform operator must provide the Office wrapper, Collabora service and platform Collaboration service. Install a signed Office package and approve its exact document-processing consent before opening files. You need access to the selected workspace document; no separate personal Collabora account is required.

## Important limits

The external editor and its operator receive and process document content under the approved consent. Format support and view/edit availability vary by file type, and complex formatting may differ from other office suites. This is Collabora in the browser, not desktop LibreOffice. A successful save must be confirmed by the workspace; an unsigned offline package cannot authorise a live editor session.

The agent's read tool asks for read access to workspace files (file.read). When the agent reads a document, Office downloads the last saved version with a short-lived token for that user, converts it to text with its Collabora service and returns the text without storing it. While you have a document open and follow the agent, it can read only the text you've selected and insert text at your cursor. Office never saves for the agent: you review the change and save it. The agent can't read drawings, and it can't edit documents that aren't open.

## A closer look

The listing gallery contains three real editor captures:

Spreadsheet editing in Collabora: original synthetic season budget, not customer data.

Document editing in Collabora: original synthetic planning brief, not a desktop LibreOffice screenshot.

Presentation editing in Collabora: original synthetic slide, captured from the real browser editor.

## Artwork and attribution

Original Verentis marketplace vector artwork created for this listing in September 2026. Original artwork follows this repository’s applicable license; no additional rights to third-party names or trademarks are granted. Gallery PNGs are new captures of an isolated local instance of the same pinned Collabora CODE browser editor shipped with Office, using original synthetic OOXML documents in samples/. They show the editor itself, not private workspace chrome, and are not evidence of a full workspace launch or save test. Collabora/LibreOffice interface artwork and marks remain their owners’ property under applicable upstream component terms, primarily MPL-2.0; see https://github.com/CollaboraOnline/online and https://www.libreoffice.org/about-us/licenses/. The repository THIRD-PARTY-NOTICES.md remains applicable; screenshots do not relicense upstream software or imply endorsement.
