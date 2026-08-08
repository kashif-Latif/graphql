import { env } from "../config/env.js";
import { logger, timer } from "../utils/logger.js";
import { respectThrottle } from "./client.js";
import { fetchProductPage, fetchAllVariants } from "./pagination.js";
import { toSearchResult } from "./normalizeProduct.js";
import { matchingVariants, searchQueryLadder, productMatchesKeywords } from "./filters.js";
import { recordSearch } from "../utils/trace.js";

/** How many products per search may pay for a deep variant fetch. */
const DEEP_VARIANT_FETCH_BUDGET = 3;

function needsVariantDetail(filters) {
  return Boolean(
    filters.color ||
      filters.size ||
      filters.age !== undefined ||
      Number.isFinite(filters.minPrice) ||
      Number.isFinite(filters.maxPrice) ||
      filters.inStock
  );
}

function cheapestPrice(variants) {
  const prices = variants.map((v) => v.price).filter((p) => typeof p === "number");
  return prices.length ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}

/**
 * Search Shopify, page by page, stopping as soon as enough good matches exist.
 *
 * Never fetches the whole catalogue: bounded by MAX_PAGES_PER_SEARCH and by
 * the requested result limit.
 *
 * @param {object} filters see searchFiltersSchema
 * @param {{requestId?: string}} [meta]
 * @returns {Promise<{products: object[], count: number, meta: object}>}
 */
export async function searchProductsCore(filters = {}, meta = {}) {
  const elapsed = timer();
  const limit = Math.min(filters.limit || env.search.maxResults, env.search.maxResults);
  const pageSize = env.search.pageSize;
  const maxPages = env.search.maxPages;
  const ladder = searchQueryLadder(filters);
  const wantVariantDetail = needsVariantDetail(filters);

  let totalPages = 0;
  let candidateCount = 0;
  let deepFetches = 0;
  let usedQuery = null;
  let results = [];

  for (const searchQuery of ladder) {
    usedQuery = searchQuery;
    results = [];
    let cursor = null;
    let hasNextPage = true;
    let pagesForThisQuery = 0;

    while (
      hasNextPage &&
      results.length < limit &&
      pagesForThisQuery < maxPages
    ) {
      if (pagesForThisQuery > 0) await respectThrottle();

      const page = await fetchProductPage({
        searchQuery,
        cursor,
        first: pageSize,
        requestId: meta.requestId,
      });

      pagesForThisQuery += 1;
      totalPages += 1;
      candidateCount += page.products.length;

      for (const product of page.products) {
        if (results.length >= limit) break;

        // A widened query must not drag in irrelevant products.
        if (filters.query && !productMatchesKeywords(product, filters.query)) continue;

        let variants = product.variants;
        let matches = matchingVariants({ ...product, variants }, filters);

        // The product may have more variants than the first variant page.
        if (
          matches.length === 0 &&
          product.variantsHaveNextPage &&
          wantVariantDetail &&
          deepFetches < DEEP_VARIANT_FETCH_BUDGET
        ) {
          deepFetches += 1;
          const full = await fetchAllVariants({
            productId: product.id,
            requestId: meta.requestId,
          });
          if (full.variants.length) {
            variants = full.variants;
            matches = matchingVariants({ ...product, variants }, filters);
          }
        }

        if (matches.length === 0) continue;

        matches.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
        results.push(
          toSearchResult(product, matches.slice(0, env.search.maxVariantsPerProduct), {
            totalMatching: matches.length,
          })
        );
      }

      hasNextPage = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
    }

    if (results.length > 0) break;
  }

  if (Number.isFinite(filters.maxPrice) || filters.sort === "price_asc") {
    results.sort((a, b) => cheapestPrice(a.matchingVariants) - cheapestPrice(b.matchingVariants));
  }

  const durationMs = elapsed();
  recordSearch({
    requestId: meta.requestId,
    queryUsed: usedQuery,
    pagesFetched: totalPages,
    deepVariantFetches: deepFetches,
    candidateProducts: candidateCount,
    finalProducts: results.length,
  });
  logger.info("search.completed", {
    requestId: meta.requestId,
    filters,
    queryUsed: usedQuery,
    pagesFetched: totalPages,
    deepVariantFetches: deepFetches,
    candidateProducts: candidateCount,
    finalProducts: results.length,
    durationMs,
  });

  return {
    products: results.slice(0, limit),
    count: Math.min(results.length, limit),
    meta: {
      queryUsed: usedQuery,
      pagesFetched: totalPages,
      candidateProducts: candidateCount,
      durationMs,
    },
  };
}
