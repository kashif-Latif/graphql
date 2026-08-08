import * as z from "zod";
import { shopifyGraphQL } from "../shopify/client.js";
import { DISCOUNTS_QUERY } from "../shopify/queries.js";
import { logger } from "../utils/logger.js";

/**
 * Store-wide promotions, read live from Shopify.
 *
 * Discounts change far less often than inventory, so a short TTL cache keeps
 * this off the Shopify budget when several chat turns mention offers. The
 * cache is deliberately tiny (one entry) and time-bounded — it is not a
 * catalogue copy.
 */

const CACHE_TTL_MS = 60_000;
const MAX_PAGES = 3;
const PAGE_SIZE = 20;

let cache = { at: 0, value: null };

export const getDiscountsSchema = z.object({
  activeOnly: z.boolean().default(true),
});

const AUTOMATIC = /^DiscountAutomatic/;

function normalizeDiscountNode(node) {
  const discount = node?.discount;
  if (!discount || !discount.__typename) return null;

  const typeName = discount.__typename;
  const codes = (discount.codes?.nodes || []).map((entry) => entry.code).filter(Boolean);

  return {
    id: node.id,
    title: discount.title ?? null,
    // The customer-facing sentence Shopify itself generates — never invented.
    summary: discount.summary ?? null,
    status: discount.status ?? null,
    startsAt: discount.startsAt ?? null,
    endsAt: discount.endsAt ?? null,
    appliesAutomatically: AUTOMATIC.test(typeName),
    codes,
    kind: typeName.includes("FreeShipping")
      ? "free_shipping"
      : typeName.includes("Bxgy")
        ? "buy_x_get_y"
        : "amount_off",
    type: typeName,
  };
}

/** A discount is live only if Shopify says ACTIVE *and* the window is open. */
export function isCurrentlyRunning(discount, now = Date.now()) {
  if (discount.status !== "ACTIVE") return false;
  const starts = discount.startsAt ? Date.parse(discount.startsAt) : null;
  const ends = discount.endsAt ? Date.parse(discount.endsAt) : null;
  if (Number.isFinite(starts) && starts > now) return false;
  if (Number.isFinite(ends) && ends < now) return false;
  return true;
}

/**
 * @param {{activeOnly?: boolean}} [rawInput]
 * @returns {Promise<{discounts: object[], count: number, cached: boolean}>}
 */
export async function getDiscounts(rawInput = {}, meta = {}) {
  const { activeOnly } = getDiscountsSchema.parse(rawInput);

  let all;
  const fresh = cache.value && Date.now() - cache.at < CACHE_TTL_MS;
  if (fresh) {
    all = cache.value;
  } else {
    all = [];
    let cursor = null;
    let hasNextPage = true;
    let pages = 0;

    while (hasNextPage && pages < MAX_PAGES) {
      const { data } = await shopifyGraphQL(
        DISCOUNTS_QUERY,
        { first: PAGE_SIZE, after: cursor },
        { operationName: "Discounts", requestId: meta.requestId }
      );
      pages += 1;
      const connection = data.discountNodes || { nodes: [], pageInfo: {} };
      for (const node of connection.nodes || []) {
        const normalized = normalizeDiscountNode(node);
        if (normalized) all.push(normalized);
      }
      hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
      cursor = connection.pageInfo?.endCursor ?? null;
    }

    cache = { at: Date.now(), value: all };
    logger.info("discounts.fetched", { requestId: meta.requestId, pages, count: all.length });
  }

  const discounts = activeOnly ? all.filter((discount) => isCurrentlyRunning(discount)) : all;
  return { discounts, count: discounts.length, cached: Boolean(fresh) };
}

/** Test hook. */
export function clearDiscountCache() {
  cache = { at: 0, value: null };
}
