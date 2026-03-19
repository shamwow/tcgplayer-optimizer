import type { CartItem } from "@/types";

const MPAPI_BASE = "https://mpapi.tcgplayer.com/v2";
const MPGATEWAY_BASE = "https://mpgateway.tcgplayer.com/v1";
const MP_SEARCH_BASE = "https://mp-search-api.tcgplayer.com/v1";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  Origin: "https://www.tcgplayer.com",
  Referer: "https://www.tcgplayer.com/",
};

// --- Response types ---

interface ApiResponse<T> {
  errors: Array<{ code: string; message: string }>;
  results: T[];
}

interface UserResult {
  cartKey: string | null;
  userName: string;
  userId: number;
  userKey: string;
  shippingCountry: string;
}

interface CartCreateResult {
  cartKey: string;
}

interface CartSummaryResult {
  cartKey: string;
  userId: number;
  itemCount: number;
  fulfillerCount: number;
  requestedTotalCost: number;
  estimatedShippingCost: number;
  sellers: CartSeller[];
}

interface CartSeller {
  sellerId: number;
  sellerKey: string;
  isDirect: boolean;
  productTotalCost: number;
  shippingCost: number;
  selectedShippingOption: {
    sellerId: number;
    shippingMethodCode: string;
    price: number;
    displayText: string;
  } | null;
}

interface ValidateCartResult {
  cartItems: ValidatedCartItem[];
}

interface ValidatedCartItem {
  cartItemId: number;
  sku: number;
  quantity: number;
  savedPrice: number;
  currentPrice: number;
  sellerId: number;
  sellerKey: string;
  isDirect: boolean;
  status: string;
}

interface ProductForSku {
  sku: number;
  productId: number;
  productName: string;
  setName: string;
  categoryId: number;
  condition: string;
  printing: string;
  rarity: string;
}

interface SellerShippingInfo {
  sellerId: number;
  sellerKey: string;
  displayName: string;
  isGoldStar: boolean;
  sellerShippingOptions: Array<{
    shippingMethodCode: string;
    name: string;
    price: number;
    thresholdPrice?: number;
    shippingPriceUnderThreshold?: number;
    shippingPriceOverThreshold?: number;
  }>;
}

// --- API Functions ---

/**
 * Get the user's cart key. First checks the user API (for logged-in users),
 * then falls back to creating an anonymous cart.
 */
export async function getCartKey(): Promise<string | null> {
  const response = await fetch(`${MPAPI_BASE}/user`, {
    headers: HEADERS,
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`User API error: ${response.status}`);
  }

  const data: ApiResponse<UserResult> = await response.json();
  return data.results?.[0]?.cartKey ?? null;
}

/**
 * Read the cart key from the StoreCart_PRODUCTION cookie.
 * Works in both browser extension and content script contexts.
 */
export function getCartKeyFromCookie(cookieStr: string): string | null {
  const match = cookieStr.match(
    /StoreCart_PRODUCTION=CK=([a-f0-9]+)(?:&|;|$)/
  );
  return match?.[1] ?? null;
}

/**
 * Create an anonymous cart. Returns the new cart key.
 */
export async function createAnonymousCart(): Promise<string> {
  const response = await fetch(
    `${MPGATEWAY_BASE}/cart/create/anonymouscart`,
    {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(`Create cart error: ${response.status}`);
  }

  const data: ApiResponse<CartCreateResult> = await response.json();
  const cartKey = data.results?.[0]?.cartKey;
  if (!cartKey) throw new Error("No cart key in create response");
  return cartKey;
}

/**
 * Remove an item from the cart by its cartItemId.
 */
export async function removeItemFromCart(
  cartKey: string,
  cartItemId: number
): Promise<void> {
  const response = await fetch(
    `${MPGATEWAY_BASE}/cart/${cartKey}/item/${cartItemId}`,
    {
      method: "DELETE",
      headers: HEADERS,
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(`Remove from cart error: ${response.status}`);
  }
}

/**
 * Add an item to the cart.
 */
const ADD_TO_CART_MAX_RETRIES = 3;

export async function addItemToCart(
  cartKey: string,
  sku: number,
  sellerKey: string,
  quantity: number = 1,
  countryCode: string = "US",
  channelId: number = 0
): Promise<void> {
  // channelId=1 listings are not supported. The add-to-cart API returns HTTP 200 with
  // status=0 (success), but the item silently fails to appear in the cart.
  if (channelId === 1) {
    throw new Error(`channelId=1 listings are not supported — they silently fail to appear in the cart (sku=${sku}, seller=${sellerKey})`);
  }
  for (let attempt = 1; attempt <= ADD_TO_CART_MAX_RETRIES; attempt++) {
    const response = await fetch(
      `${MPGATEWAY_BASE}/cart/${cartKey}/item/add`,
      {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sku,
          sellerKey,
          channelId,
          requestedQuantity: quantity,
          isDirect: false,
          countryCode,
        }),
      }
    );

    const body = await response.json().catch(() => null);
    console.log(`[TCG Cart API] addItemToCart attempt ${attempt}/${ADD_TO_CART_MAX_RETRIES}: HTTP ${response.status}, sku=${sku}, sellerKey=${sellerKey}`, body);

    if (!response.ok) {
      const errMsg = body?.errors?.[0]?.message ?? `HTTP ${response.status}`;
      if (attempt < ADD_TO_CART_MAX_RETRIES) {
        console.warn(`[TCG Cart API] Add failed (attempt ${attempt}), retrying: ${errMsg}`);
        continue;
      }
      throw new Error(`${errMsg} (sku=${sku}, seller=${sellerKey})`);
    }

    // HTTP 200 — check the response payload
    const result = body?.results?.[0];
    if (result && result.status === 0 && result.itemQuantityInCart >= 1) {
      console.log(`[TCG Cart API] Add response OK: sku=${sku}, qty=${result.itemQuantityInCart}`);
      return;
    }

    // Response was 200 but status != 0 or qty < 1 — something went wrong silently
    console.warn(`[TCG Cart API] Add returned 200 but unexpected result: sku=${sku}`, result);
    if (attempt < ADD_TO_CART_MAX_RETRIES) {
      continue;
    }
    throw new Error(`Add returned OK but item not confirmed (sku=${sku}, seller=${sellerKey}, status=${result?.status}, qty=${result?.itemQuantityInCart})`);

  }
}

/**
 * Get the cart summary with seller breakdown and items.
 */
export async function getCartSummary(
  cartKey: string
): Promise<CartSummaryResult> {
  const response = await fetch(
    `${MPGATEWAY_BASE}/cart/${cartKey}/summary`,
    {
      headers: HEADERS,
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(`Cart summary error: ${response.status}`);
  }

  const data: ApiResponse<CartSummaryResult> = await response.json();
  if (!data.results?.[0]) throw new Error("Empty cart summary response");
  return data.results[0];
}

/**
 * Validate cart and get full item details including SKU IDs.
 */
export async function validateCart(
  cartKey: string,
  countryCode: string = "US"
): Promise<ValidatedCartItem[]> {
  const response = await fetch(
    `${MPGATEWAY_BASE}/cart/${cartKey}/validatecartandautosaveforlater?validateForCheckout=false&countryCode=${countryCode}&checkSellers=false`,
    {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(`Validate cart error: ${response.status}`);
  }

  const data: ApiResponse<ValidateCartResult> = await response.json();
  return data.results?.[0]?.cartItems ?? [];
}

/**
 * Look up product details for a list of SKU IDs.
 */
export async function getProductsForSkus(
  skus: number[]
): Promise<ProductForSku[]> {
  const response = await fetch(
    `${MP_SEARCH_BASE}/product/getProductForSkus`,
    {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(skus),
    }
  );

  if (!response.ok) {
    throw new Error(`Product lookup error: ${response.status}`);
  }

  const data: ApiResponse<ProductForSku[]> = await response.json();
  // API returns results as array of arrays
  return data.results?.flat() ?? [];
}

/**
 * Look up seller shipping info.
 */
export async function getSellerShippingInfo(
  sellers: Array<{ sellerId: number; largestShippingCategoryId: number }>,
  countryCode: string = "US"
): Promise<SellerShippingInfo[]> {
  const response = await fetch(
    `${MPAPI_BASE}/seller/shippinginfo?countryCode=${countryCode}`,
    {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(sellers),
    }
  );

  if (!response.ok) {
    throw new Error(`Seller shipping info error: ${response.status}`);
  }

  const data: ApiResponse<SellerShippingInfo[]> = await response.json();
  return data.results?.flat() ?? [];
}

/**
 * Fetch the user's full cart as CartItem[] for the optimizer.
 * Combines cart summary, product details, and seller info.
 */
export async function fetchCartItems(cartKey: string): Promise<CartItem[]> {
  // Step 1: Validate cart to get item details with SKUs
  const cartItems = await validateCart(cartKey);
  if (cartItems.length === 0) return [];

  // Step 2: Look up product details for all SKUs
  const skus = cartItems.map((item) => item.sku);
  const products = await getProductsForSkus(skus);

  // Build SKU → product lookup
  const productBySku = new Map<number, ProductForSku>();
  for (const product of products) {
    productBySku.set(product.sku, product);
  }

  // Step 3: Look up seller display names
  const uniqueSellers = new Map<number, number>(); // sellerId → largestShippingCategoryId
  for (const cartItem of cartItems) {
    if (!uniqueSellers.has(cartItem.sellerId)) {
      uniqueSellers.set(cartItem.sellerId, 0);
    }
  }
  const sellerNameById = new Map<number, string>();
  try {
    const sellerInfos = await getSellerShippingInfo(
      Array.from(uniqueSellers.entries()).map(([sellerId, catId]) => ({
        sellerId,
        largestShippingCategoryId: catId,
      }))
    );
    for (const info of sellerInfos) {
      sellerNameById.set(info.sellerId, info.displayName);
    }
  } catch {
    // Non-critical — fall back to empty seller names
  }

  // Step 4: Map to CartItem[]
  const items: CartItem[] = [];
  for (let i = 0; i < cartItems.length; i++) {
    const cartItem = cartItems[i];
    const product = productBySku.get(cartItem.sku);
    if (!product) {
      console.warn(`[TCG Cart API] Dropping cart item: no product found for SKU ${cartItem.sku} (seller=${cartItem.sellerKey}, price=$${cartItem.currentPrice})`);
      continue;
    }

    items.push({
      cartIndex: i,
      productId: product.productId,
      sku: cartItem.sku,
      name: product.productName,
      condition: product.condition,
      printing: product.printing,
      setName: product.setName,
      rarity: product.rarity,
      quantity: cartItem.quantity,
      currentPriceCents: Math.round(cartItem.currentPrice * 100),
      currentSeller: sellerNameById.get(cartItem.sellerId) ?? "",
      currentSellerKey: cartItem.sellerKey,
    });
  }

  return items;
}
