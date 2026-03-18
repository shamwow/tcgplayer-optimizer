import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { JSDOM } from "jsdom";
import {
  readCart,
  parsePriceToCents,
  extractProductId,
} from "../../src/content/cart-reader";

describe("parsePriceToCents", () => {
  it("parses dollar amounts", () => {
    expect(parsePriceToCents("$1.23")).toBe(123);
    expect(parsePriceToCents("$0.25")).toBe(25);
    expect(parsePriceToCents("$10.00")).toBe(1000);
    expect(parsePriceToCents("$0.99")).toBe(99);
  });

  it("handles missing dollar sign", () => {
    expect(parsePriceToCents("1.23")).toBe(123);
  });

  it("handles invalid input", () => {
    expect(parsePriceToCents("")).toBe(0);
    expect(parsePriceToCents("free")).toBe(0);
  });
});

describe("extractProductId", () => {
  it("extracts from standard product URLs", () => {
    expect(
      extractProductId(
        "https://www.tcgplayer.com/product/528692/magic-foundations-llanowar-elves"
      )
    ).toBe(528692);
  });

  it("extracts from short URLs", () => {
    expect(
      extractProductId("https://www.tcgplayer.com/product/12345")
    ).toBe(12345);
  });

  it("returns 0 for invalid URLs", () => {
    expect(extractProductId("")).toBe(0);
    expect(extractProductId("https://www.tcgplayer.com/cart")).toBe(0);
  });
});

describe("readCart", () => {
  it("parses cart HTML fixture into CartItem[]", () => {
    const html = readFileSync(
      resolve(__dirname, "../fixtures/cart.html"),
      "utf-8"
    );
    const dom = new JSDOM(html);
    const items = readCart(dom.window.document);

    expect(items).toHaveLength(3);

    expect(items[0]).toMatchObject({
      cartIndex: 0,
      productId: 528692,
      name: "Llanowar Elves",
      condition: "Near Mint",
      printing: "Normal",
      setName: "Foundations",
      rarity: "Common",
      quantity: 1,
      currentPriceCents: 25,
      currentSeller: "CardKingdom",
    });

    expect(items[1]).toMatchObject({
      cartIndex: 1,
      productId: 528750,
      name: "Lightning Bolt",
      condition: "Near Mint",
      printing: "Foil",
      currentPriceCents: 150,
    });

    expect(items[2]).toMatchObject({
      cartIndex: 2,
      productId: 530100,
      name: "Counterspell",
      condition: "Lightly Played",
      printing: "Normal",
      quantity: 2,
      currentPriceCents: 75,
    });
  });

  it("returns empty array for empty cart", () => {
    const dom = new JSDOM("<div></div>");
    const items = readCart(dom.window.document);
    expect(items).toHaveLength(0);
  });
});
