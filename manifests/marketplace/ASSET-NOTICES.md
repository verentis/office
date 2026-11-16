# Asset origins and rights

Original Verentis marketplace vector artwork created for this listing in September 2026. Original artwork follows this repository’s applicable license; no additional rights to third-party names or trademarks are granted. Gallery PNGs are actual captures of the pinned Collabora CODE browser editor, not desktop LibreOffice, upstream marketing images or mockups. Collabora/LibreOffice interface artwork and marks remain their owners’ property under applicable upstream component terms, primarily MPL-2.0; see https://github.com/CollaboraOnline/online and https://www.libreoffice.org/about-us/licenses/. The repository THIRD-PARTY-NOTICES.md remains applicable; screenshots do not relicense upstream software or imply endorsement.

- logo.svg: original Verentis product-specific artwork.
- hero.svg: original subdued, text-free background with layered paper-like planes. No prominent logo or interface is embedded; the centre remains quiet for marketplace overlays and responsive cover cropping.
- Gallery: actual local Collabora captures of original synthetic samples.
- No customer records, external hotlinks or vendor endorsement are part of this listing.

## Capture provenance

Captured 2026-09-28 from an isolated local instance of the same Collabora CODE image used by Office: `docker.io/collabora/code@sha256:1efda3043e8b9cb437d1b6c6efe20cc3753760e634de012b8dac391da488bf97`, pinned in ../../deploy/code.lock.json (CODE 26.04.4.1.1).

The three files in samples/ are original fictional documents; no upstream templates or customer data were used. A synthetic-only local WOPI fixture served these files to the unmodified editor. Playwright captured the actual 1440 × 1000 browser viewport after the editor loaded and its welcome dialog was dismissed through its close control. No mock UI, compositing or retouching was used.

The existing workspace host was not changed. Its interactive sign-in prevented an unattended full workspace capture, so these images show only the actual CODE editing interface, not the Verentis wrapper or workspace. They do not establish platform launch, consent, collaboration or durable-save correctness.

Upstream software and embedded marks retain their existing component licenses and trademark restrictions. See ../../THIRD-PARTY-NOTICES.md; this inventory is not a claim of completed legal clearance.

## Official logo replacement — blocked on trademark-use clarification

The requested authentic LibreOffice logo has not been incorporated. The current
`logo.svg` is custom artwork and does not satisfy that requirement.

TDF supplies an [official external-use logo](https://wiki.documentfoundation.org/File:LibreOffice_external_logo.svg)
without the reserved “The Document Foundation” subline. Its file-page
[license declaration](https://wiki.documentfoundation.org/Template:CC-BY-SA-3.0-LGPLv3p-MPL)
offers CC BY-SA 3.0 Unported, LGPL v3 or later, or MPL 1.1. These are artwork
copyright licenses, separate from the editor software's licenses and trademark
permission; a copyright license alone does not clear this listing's use.

The [Logo Policy](https://wiki.documentfoundation.org/TDF/Policies/Logo_Policy)
and [Trademark Policy](https://wiki.documentfoundation.org/TDF/Policies/Trademark_Policy)
permit factual component identification and clearly distinguished “based on”
references. The trademark policy also expressly flags confusing app-store
application names as non-permitted. This package is currently named “Libre Office”
but supplies a Verentis wrapper around Collabora, not a TDF-produced application.
The published terms therefore do not establish unambiguous permission for the
proposed package-icon/name combination.

Obtain clarification or authorization from `legal@documentfoundation.org` for
this presentation before using the mark. Alternatively, a clearly distinguished
listing identity would require a separately approved naming change. Do not assume
that a disclaimer alone resolves the policy restriction. Keep the Collabora-based
description and avoid any claim of TDF endorsement. Any subsequently authorized
asset must retain its complete mark, trademark symbol, colors and aspect ratio
with neutral padding, and carry its copyright attribution/license in the packaged
README. No official asset was copied into this package.

## Manifest icons

`../icons/office.svg`, `document.svg`, `spreadsheet.svg`, `slides.svg` and `drawing.svg` are the LibreOffice,
Writer, Calc, Impress and Draw marks from the theSVG Color set (https://github.com/glincker/thesvg, MIT),
retrieved via Iconify (`thesvg-color:libreoffice*`). The MIT license covers the SVG files only; the
LibreOffice marks remain trademarks of The Document Foundation and are used to identify file types.
