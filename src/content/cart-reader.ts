import type { CartItem } from "@/types";

/**
 * Parse the TCGPlayer cart page DOM to extract cart items.
 * Relies on data-testid attributes which are relatively stable.
 */
export function readCart(doc: Document = document): CartItem[] {
  const items: CartItem[] = [];

  const cartRows = doc.querySelectorAll('[data-testid="cartItem"]');

  cartRows.forEach((row, index) => {
    const nameEl = row.querySelector('[data-testid="productName"]');
    const conditionEl = row.querySelector('[data-testid="productCondition"]');
    const printingEl = row.querySelector('[data-testid="productPrinting"]');
    const setEl = row.querySelector('[data-testid="productSetName"]');
    const rarityEl = row.querySelector('[data-testid="productRarity"]');
    const priceEl = row.querySelector('[data-testid="productPrice"]');
    const quantityEl = row.querySelector('[data-testid="productQuantity"]');
    const sellerEl = row.querySelector('[data-testid="sellerName"]');
    const linkEl = row.querySelector<HTMLAnchorElement>(
      '[data-testid="productName"] a, a[data-testid="productName"]'
    );

    const name = nameEl?.textContent?.trim() ?? "";
    const condition = conditionEl?.textContent?.trim() ?? "Near Mint";
    const printing = printingEl?.textContent?.trim() ?? "Normal";
    const setName = setEl?.textContent?.trim() ?? "";
    const rarity = rarityEl?.textContent?.trim() ?? "";
    const seller = sellerEl?.textContent?.trim() ?? "";

    // Extract price: "$1.23" → 123
    const priceText = priceEl?.textContent?.trim() ?? "$0.00";
    const priceCents = parsePriceToCents(priceText);

    // Extract quantity from input or text
    const quantityInput = quantityEl?.querySelector("input");
    const quantity = quantityInput
      ? parseInt(quantityInput.value, 10) || 1
      : parseInt(quantityEl?.textContent?.trim() ?? "1", 10) || 1;

    // Extract productId from the product link URL
    const href = linkEl?.href ?? "";
    const productId = extractProductId(href);

    if (name && productId > 0) {
      items.push({
        cartIndex: index,
        productId,
        sku: 0,
        name,
        condition,
        printing,
        setName,
        rarity,
        quantity,
        currentPriceCents: priceCents,
        currentSeller: seller,
        currentSellerKey: "",
      });
    }
  });

  return items;
}

/** Parse "$1.23" or "1.23" to 123 cents */
export function parsePriceToCents(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, "");
  const dollars = parseFloat(cleaned);
  if (isNaN(dollars)) return 0;
  return Math.round(dollars * 100);
}

/** Extract product ID from a TCGPlayer product URL */
export function extractProductId(url: string): number {
  // URL pattern: /product/12345/card-name or /product/12345
  const match = url.match(/\/product\/(\d+)/);
  if (match) return parseInt(match[1], 10);

  // Fallback: check for productId query param
  try {
    const u = new URL(url, "https://www.tcgplayer.com");
    const id = u.searchParams.get("productId");
    if (id) return parseInt(id, 10);
  } catch {
    // ignore invalid URLs
  }

  return 0;
}
