import { shopifyGraphQL } from "./client.js";
import {
  SEARCH_PRODUCTS_QUERY,
  GET_PRODUCT_VARIANTS_QUERY,
} from "./queries.js";
import { normalizeProduct, normalizeVariant } from "./normalizeProduct.js";
import { env } from "../config/env.js";

/**
 * Fetch exactly ONE page of products.
 *
 * @param {{searchQuery?: string|null, cursor?: string|null, first?: number,
 *          variantsFirst?: number, requestId?: string}} params
 * @returns {Promise<{products: object[], pageInfo: {hasNextPage: boolean, endCursor: string|null}, cost: object|undefined}>}
 */
export async function fetchProductPage({
  searchQuery = null,
  cursor = null,
  first = env.search.pageSize,
  variantsFirst = env.search.variantPageSize,
  requestId,
} = {}) {
  const { data, cost } = await shopifyGraphQL(
    SEARCH_PRODUCTS_QUERY,
    {
      first,
      after: cursor,
      query: searchQuery,
      variantsFirst,
    },
    { operationName: "SearchProducts", requestId }
  );

  const connection = data.products || { nodes: [], pageInfo: {} };
  return {
    products: (connection.nodes || []).map(normalizeProduct).filter(Boolean),
    pageInfo: {
      hasNextPage: Boolean(connection.pageInfo?.hasNextPage),
      endCursor: connection.pageInfo?.endCursor ?? null,
    },
    cost,
  };
}

/**
 * Fetch ALL variants of one product, following the variant cursor.
 * Bounded by maxPages so a pathological product cannot spin forever.
 *
 * @returns {Promise<{product: object|null, variants: object[], pagesFetched: number, truncated: boolean}>}
 */
export async function fetchAllVariants({
  productId,
  first = env.search.variantPageSize,
  maxPages = env.search.maxPages,
  requestId,
}) {
  const variants = [];
  let cursor = null;
  let hasNextPage = true;
  let pagesFetched = 0;
  let product = null;

  while (hasNextPage && pagesFetched < maxPages) {
    const { data } = await shopifyGraphQL(
      GET_PRODUCT_VARIANTS_QUERY,
      { id: productId, first, after: cursor },
      { operationName: "GetProductVariants", requestId }
    );

    pagesFetched += 1;

    if (!data.product) {
      return { product: null, variants: [], pagesFetched, truncated: false };
    }

    if (!product) {
      product = {
        id: data.product.id,
        title: data.product.title,
        handle: data.product.handle,
        url: data.product.handle ? `/products/${data.product.handle}` : null,
        options: (data.product.options || []).map((option) => ({
          id: option?.id ?? null,
          name: option?.name ?? null,
          values: option?.values || [],
        })),
      };
    }

    for (const node of data.product.variants?.nodes || []) {
      const normalized = normalizeVariant(node);
      if (normalized) variants.push(normalized);
    }

    hasNextPage = Boolean(data.product.variants?.pageInfo?.hasNextPage);
    cursor = data.product.variants?.pageInfo?.endCursor ?? null;
  }

  return { product, variants, pagesFetched, truncated: hasNextPage };
}
