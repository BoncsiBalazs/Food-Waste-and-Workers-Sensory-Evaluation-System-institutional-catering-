# Deploy ZeroWaste Entry in English – GitHub Pages

1. Unzip the release. Upload **all files and the `icons` folder** to the root of the target GitHub repository. Ensure `index.html`, `app-public-anon-v5-en.js`, `data-public-anon-v5-en.js`, `styles-public-anon-v5-en.css`, `sw-public-anon-v5-en.js`, `manifest.webmanifest` and `mate_logo.png` are present.
2. In GitHub, go to **Settings → Pages**, select **Deploy from a branch**, then the **main** branch and the **/(root)** folder. Save.
3. Visit the Pages URL. If an existing Hungarian site is being overwritten, perform a hard refresh (Ctrl+Shift+R), or test in a private browser window. PWA caches are versioned to prevent old-language assets being reused.
4. Check English age groups, institutions, food suggestions, CATA descriptors, both measurement steps, the review screen, saved records, the portion guide and CSV/ZIP downloads.
5. Export a test ZIP and verify that the `entry_events.csv` data can still be imported by the ZeroWaste R pipeline. Keep one copy of the original Hungarian site until validation has succeeded.

**Separate English website recommended:** create a new repository (for example `zerowaste-entry-en`) so the original Hungarian GitHub Pages site remains available. Upload these files to that repository root and enable Pages. If your custom domain currently points to the Hungarian repository, the English site will have its own GitHub Pages URL until you configure a separate domain or redirect.

**Important:** The English release stores entries in a separate IndexedDB database. Export any existing entries from the Hungarian site before replacing it.
