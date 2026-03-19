# src/content

Content script injected on `tcgplayer.com` pages. Renders the optimizer overlay UI.

## Files

- **index.ts** — Main overlay implementation (~1500 lines). Creates a fixed-position panel on the right side of the page using Shadow DOM for style isolation. Manages a mutable `OverlayState` object and re-renders the entire overlay on state changes via `render()`. Implements the 3-step workflow: export cart, run solver, import and apply results. Handles file drag-and-drop, text paste, clipboard copy, and progress bar display. Communicates with the service worker via `chrome.runtime.sendMessage`. Polls the page DOM every 3s to detect cart changes.
- **cart-reader.ts** — Parses the TCGPlayer cart page DOM using `data-testid` attributes to extract cart items (name, condition, printing, set, price, seller, product ID from URL). Returns `CartItem[]` with `sku: 0` (the real SKU comes from the API layer later).
- **render-utils.ts** — `replaceHtmlPreservingScroll()` captures scroll positions of scrollable containers before an `innerHTML` replacement and restores them after, preventing scroll reset during re-renders.

## Key Design Decisions

- **Shadow DOM**: The overlay's styles are completely isolated from TCGPlayer's page CSS. All styles are injected into the shadow root.
- **Full re-render on state change**: Instead of a virtual DOM diffing approach, the overlay re-renders all HTML on every state change. `replaceHtmlPreservingScroll()` mitigates the main downside (scroll position loss).
- **DOM-based cart reading**: `cart-reader.ts` parses the page DOM as a quick initial read. The service worker then fetches authoritative data (SKUs, seller keys) from the API.
