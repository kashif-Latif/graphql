import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShopifyProductSearchQuery,
  variantMatchesFilters,
  matchingVariants,
} from "../src/shopify/filters.js";
import { normalizeVariant } from "../src/shopify/normalizeProduct.js";
import { variant } from "./helpers/shopifyMock.js";

test("search query builder only emits Shopify-supported syntax", () => {
  const query = buildShopifyProductSearchQuery({
    query: "baby towel",
    vendor: "Little Minors",
    productType: "Towels",
    minPrice: 100,
    maxPrice: 500,
    // These must NOT reach Shopify search syntax:
    color: "pink",
    size: "1-2 years",
    age: 2,
    inStock: true,
  });

  assert.match(query, /status:ACTIVE/);
  assert.match(query, /vendor:"Little Minors"/);
  assert.match(query, /product_type:"Towels"/);
  assert.match(query, /price:>=100/);
  assert.match(query, /price:<=500/);
  assert.doesNotMatch(query, /color/i);
  assert.doesNotMatch(query, /size/i);
  assert.doesNotMatch(query, /inventory/i);
  assert.doesNotMatch(query, /age/i);
});

test("search query builder escapes quotes in user text", () => {
  const query = buildShopifyProductSearchQuery({ vendor: 'Ev"il OR status:DRAFT' });
  assert.match(query, /vendor:"Ev\\"il OR status:DRAFT"/);
});

test("all filters must match the SAME variant", () => {
  const pinkExpensive = normalizeVariant(variant({ color: "Pink", size: "5", price: "2000.00" }));
  const blackCheap = normalizeVariant(variant({ color: "Black", size: "2", price: "900.00" }));
  const product = { variants: [pinkExpensive, blackCheap] };
  const filters = { color: "pink", size: "2", maxPrice: 1000 };

  assert.equal(variantMatchesFilters(pinkExpensive, filters), false);
  assert.equal(variantMatchesFilters(blackCheap, filters), false);
  assert.deepEqual(matchingVariants(product, filters), []);
});

test("the same variant satisfying every filter does match", () => {
  const target = normalizeVariant(variant({ color: "Pink", size: "30*30 Inches", price: "399.00" }));
  assert.equal(
    variantMatchesFilters(target, { color: "pink", maxPrice: 500, inStock: true }),
    true
  );
});

test("inStock rejects zero and unknown inventory", () => {
  const zero = normalizeVariant(variant({ color: "Pink", inventoryQuantity: 0 }));
  const untracked = normalizeVariant(variant({ color: "Pink", inventoryQuantity: null }));
  assert.equal(variantMatchesFilters(zero, { inStock: true }), false);
  assert.equal(variantMatchesFilters(untracked, { inStock: true }), false);
  assert.equal(variantMatchesFilters(zero, {}), true);
});

test("malformed price is excluded from price-bounded searches", () => {
  const broken = normalizeVariant(variant({ color: "Pink", price: "abc" }));
  assert.equal(broken.price, null);
  assert.equal(variantMatchesFilters(broken, { maxPrice: 1000 }), false);
  assert.equal(variantMatchesFilters(broken, { minPrice: 100 }), false);
  assert.equal(variantMatchesFilters(broken, { color: "pink" }), true);
});

test("price bounds are inclusive", () => {
  const exact = normalizeVariant(variant({ price: "1000.00" }));
  assert.equal(variantMatchesFilters(exact, { maxPrice: 1000 }), true);
  assert.equal(variantMatchesFilters(exact, { minPrice: 1000 }), true);
  assert.equal(variantMatchesFilters(exact, { maxPrice: 999 }), false);
});
