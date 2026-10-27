# ZeroWaste Entry – English version v5.0.2

This release is the English-only user interface, with **Odour** as the sensory-attribute label in both the soup and main-course forms and all associated CATA descriptors.

## Compatibility
- Keeps the existing IndexedDB name: `zerowaste-entry-public-anon-v5-en`.
- Keeps the original `smell` field key and export columns for backward compatibility with the ZeroWaste R processing pipeline.
- Preserves the six-step observation workflow, local data storage, food list, and all export functionality.
- Changes only resource filenames, service-worker cache version, and visible version label relative to v5.0.1; no scientific or calculation rules are changed.

## What is included
The release root contains `index.html`, version-specific JavaScript and CSS files, a service worker, `manifest.webmanifest`, logo, and icons. Upload **the contents of the ZIP**, not the ZIP itself and not a nested folder.

For exact deployment and verification, see `GITHUB_PAGES.md`.
