# src/popup

Extension popup shown when clicking the toolbar icon. Displays brief instructions pointing the user to the cart page overlay.

## Files

- **popup.html** — HTML shell that mounts React into `#root`.
- **main.tsx** — React entry point, renders `<Popup />` in strict mode.
- **Popup.tsx** — Stateless React component showing the project name, a note that solving runs via the CLI, and the `npm run solve` command.

No interactive logic — the real UI lives in the content script overlay.
