import { colorMatches, sizeMatches, normalizeText } from "../utils/normalize.js";
import { variantMatchesAge } from "../utils/age.js";
import { productHaystack } from "./normalizeProduct.js";

/**
 * Which filters belong in the Shopify `products(query:)` search string.
 *
 * Supported by the Admin API product search (and used here):
 *   title, vendor, product_type, tag, status, price, handle, sku
 * Deliberately NOT pushed into Shopify search:
 *   color / size  -> live on variant selectedOptions, not searchable reliably
 *   age           -> encoded inside option values, no Shopify syntax for it
 *   inStock       -> inventory_total can be skewed by negative stock on other
 *                    variants, so it is enforced per-variant in JS instead
 *
 * Everything not listed above is applied in JavaScript against normalized
 * variants (see variantMatchesFilters).
 */

const STOP_WORDS = new Set([
  "a", "an", "the", "for", "me", "my", "show", "find", "need", "want", "please",
  "some", "something", "any", "with", "and", "or", "of", "in", "on", "under",
  "below", "over", "above", "between", "rs", "inr", "price", "priced", "cheap",
  "cheaper", "available", "stock", "products", "product", "items", "item",
  "year", "years", "old", "month", "months",
]);

function quote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function keywordTerms(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

/**
 * @param {object} filters
 * @param {{mode?: "strict"|"loose"|"broad"}} [options]
 *        strict — all keyword terms ANDed (default)
 *        loose  — keyword terms ORed
 *        broad  — structured filters only, no free text
 * @returns {string|null} value for the `$query` GraphQL variable
 */
export function buildShopifyProductSearchQuery(filters = {}, options = {}) {
  const mode = options.mode || "strict";
  const clauses = [];

  clauses.push("status:ACTIVE");

  if (filters.vendor) clauses.push(`vendor:${quote(filters.vendor)}`);
  if (filters.productType) clauses.push(`product_type:${quote(filters.productType)}`);
  if (filters.category) clauses.push(`(tag:${quote(filters.category)} OR product_type:${quote(filters.category)})`);
  if (filters.handle) clauses.push(`handle:${quote(filters.handle)}`);

  if (Number.isFinite(filters.minPrice)) clauses.push(`price:>=${filters.minPrice}`);
  if (Number.isFinite(filters.maxPrice)) clauses.push(`price:<=${filters.maxPrice}`);

  if (mode !== "broad" && filters.query) {
    const terms = keywordTerms(filters.query);
    if (terms.length) {
      const joined = terms.map(quote).join(mode === "loose" ? " OR " : " AND ");
      clauses.push(terms.length > 1 ? `(${joined})` : joined);
    }
  }

  return clauses.length ? clauses.join(" AND ") : null;
}

/** Ordered fallback ladder: narrow first, widen only if nothing is found. */
export function searchQueryLadder(filters) {
  const ladder = [buildShopifyProductSearchQuery(filters, { mode: "strict" })];
  const loose = buildShopifyProductSearchQuery(filters, { mode: "loose" });
  if (loose !== ladder[0]) ladder.push(loose);
  const broad = buildShopifyProductSearchQuery(filters, { mode: "broad" });
  if (!ladder.includes(broad)) ladder.push(broad);
  return ladder;
}

/**
 * ALL requested variant-level conditions must hold for the SAME variant.
 * A product with a pink Rs 2000 variant and a black Rs 900 variant does NOT
 * satisfy "pink under Rs 1000".
 *
 * @param {object} variant normalized variant
 * @param {object} filters
 * @returns {boolean}
 */
export function variantMatchesFilters(variant, filters = {}) {
  if (!variant) return false;

  if (filters.color && !colorMatches(variant.color ?? variant.title, filters.color)) return false;

  if (filters.size && !sizeMatches(variant.size ?? variant.title, filters.size)) return false;

  if (filters.age !== undefined && filters.age !== null && !variantMatchesAge(variant, filters.age)) {
    return false;
  }

  if (Number.isFinite(filters.minPrice)) {
    if (variant.price === null || variant.price < filters.minPrice) return false;
  }

  if (Number.isFinite(filters.maxPrice)) {
    if (variant.price === null || variant.price > filters.maxPrice) return false;
  }

  if (filters.inStock === true) {
    const qty = variant.inventoryQuantity;
    // Unknown/untracked inventory is not proof of availability.
    if (!(typeof qty === "number" && qty > 0)) return false;
  }

  return true;
}

/** Cheap relevance guard so a widened Shopify query cannot return noise. */
export function productMatchesKeywords(product, query) {
  const terms = keywordTerms(query);
  if (!terms.length) return true;
  const haystack = productHaystack(product);
  return terms.some((term) => haystack.includes(term));
}

/**
 * @returns {object[]} the variants of `product` that satisfy every filter
 */
export function matchingVariants(product, filters) {
  return (product.variants || []).filter((variant) => variantMatchesFilters(variant, filters));
}
