# ZeroWaste Entry – English version (v5.0.0-en)

A browser-based, English-language data entry module for plate-waste monitoring in institutional catering. This is an anonymised demonstration/public release.

## Features

- Six-step observation form: meal-event information, soup measurements and sensory evaluation, main-course measurements and sensory evaluation, review and save.
- Food-name autocomplete in English, based on the bilingual MethodsX working glossary, plus additional translated reference entries.
- English-language CATA descriptors, food reference data, portion-size guidance, notifications, validation errors and export controls.
- Coded institution identifiers and local storage (IndexedDB): each site records and exports its data independently, without a shared database.
- CSV, XLSX, ZIP and JSON backup options. ZIP exports `entry_events.csv`, `entry_media.csv`, `manifest.json` and any attached `photos/`.
- PWA cache version specific to English to prevent the old Hungarian interface from appearing.

## Compatibility and privacy

The original machine-readable `entry_events.csv` field names and unit codes are preserved for compatibility with the ZeroWaste R-processing pipeline. **Some CSV header names and internal metadata codes therefore remain in Hungarian**; the browser interface and the reference names shown to users are in English. Keep the mapping and validate a sample export in R before a public research release. `entry_media.csv` may preserve legacy course codes.

The English release uses its own local database (`zerowaste-entry-public-anon-v5-en`). Previously entered data in the Hungarian site's browser database are **not automatically migrated**. Export any existing Hungarian records before replacing the Hungarian deployment. Do not clear browser storage before obtaining a verified backup.

Dish translations are working scientific translations, not a formally approved bilingual culinary terminology resource. Distinct Hungarian dish names that have the same English description are marked with an English-only `(variant N)` suffix to avoid ambiguous autocomplete choices. These require co-author culinary review before final research publication.

No central back-end is used. Local records are stored only in the browser profile in which they were entered.

## Deployment

See `GITHUB_PAGES.md`. Upload the files from this folder to the **repository root** or use a separate GitHub Pages repository to preserve the Hungarian version.

## Offline use

Once installed/loaded on HTTPS GitHub Pages, the service worker caches the app shell. XLSX export uses a CDN-hosted library and may require a network connection; CSV/ZIP and JSON backup do not require this library.
