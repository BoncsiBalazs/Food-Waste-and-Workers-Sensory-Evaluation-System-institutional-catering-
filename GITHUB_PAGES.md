# Deploy ZeroWaste Entry (English v5.0.2) to GitHub Pages

**This update fixes a stale-version problem.** The v5.0.1 source ZIP already contained the correct **Odour** label. If the live website still shows **Aroma**, the page is likely loading an older build or an older browser/PWA cache. v5.0.2 uses new filenames for the HTML-referenced JavaScript/CSS assets and a new service-worker cache key.

1. Open the GitHub repository that actually hosts the English Pages site, go to the `main` branch and open its root (the folder with `index.html`).
2. Unzip this release on your computer. Select **all contents of the extracted folder**, including `index.html`, the three `*v5-0-2-en*` assets, `sw-public-anon-v5-0-2-en.js`, `manifest.webmanifest`, `mate_logo.png`, and the `icons/` folder.
3. Select **Add file → Upload files** in GitHub. Upload the extracted files and commit to `main`. **Do not upload the ZIP itself.** Ensure GitHub shows an updated `index.html` in the repository root. Old `v4` or `v5.0.1` files can remain in the repo; the new `index.html` no longer references them.
4. Check **Settings → Pages**: deploy from `main`, root `/` (or follow the existing Pages workflow). Open the site's *Settings → Pages → Visit site* link.
5. In the site header, verify the visible text **English v5.0.2 · demonstration version**. This is the best indicator that GitHub Pages is loading the right release.
6. Go to **3. Soup – sensory evaluation**: the second attribute must be **Odour**. Repeat at **5. Main course – sensory evaluation**. The CATA list should show **Odour too weak**, not the old wording.
7. If you still see the old UI, first open the site in a private/incognito window. If that is correct, refresh the ordinary browser with Ctrl+Shift+R (Windows), or in Developer Tools → Application → Service Workers choose **Unregister**, then clear this site's cache data (avoid deleting IndexedDB unless your locally saved entries have been exported). Reload the site. Do not clear IndexedDB without exporting saved records first.
8. Test recording and ZIP/Excel/CSV exports using synthetic data. Export a sample and confirm compatibility with your existing R pipeline before replacing a production entry site.

## Troubleshooting
- **Still says Aroma, and no English v5.0.2 label:** the wrong files/branch/repo are deployed, or the browser is showing an old cached page.
- **English v5.0.2 label shows but Aroma appears:** open Developer Tools → Network and confirm `app-public-anon-v5-0-2-en.js` and `data-public-anon-v5-0-2-en.js` loaded successfully. This release has no `Aroma` string in runtime HTML/JS/data assets.
- **The website is blank:** check that the version-specific filenames are present alongside `index.html` at repository root.

### Technical
The UI uses **Odour**; the technical JSON/CSV field keys retain `smell` deliberately to avoid breaking previous entries and R imports. No database schema migration is necessary.
