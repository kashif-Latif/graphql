/**
 * Fake Shopify transport. The client uses global fetch, so tests install a
 * stub here instead of touching the network.
 */

const realFetch = globalThis.fetch;

export function installFetch(handler) {
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const result = await handler({
      url,
      query: body.query,
      variables: body.variables,
      headers: options.headers,
    });
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result.body ?? result), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json", ...(result.headers || {}) },
    });
  };
}

export function restoreFetch() {
  globalThis.fetch = realFetch;
}

export function variant({
  id,
  title,
  color,
  size,
  price = "999.00",
  compareAtPrice = null,
  inventoryQuantity = 5,
  sku = "SKU-1",
} = {}) {
  const selectedOptions = [];
  if (color !== undefined) selectedOptions.push({ name: "Color", value: color });
  if (size !== undefined) selectedOptions.push({ name: "Size", value: size });
  return {
    id: id || `gid://shopify/ProductVariant/${Math.floor(Math.random() * 1e12)}`,
    title: title || [color, size].filter(Boolean).join(" / ") || "Default Title",
    sku,
    price,
    compareAtPrice,
    inventoryQuantity,
    availableForSale: (inventoryQuantity ?? 0) > 0,
    selectedOptions,
  };
}

export function product({
  id = "gid://shopify/Product/1",
  title = "Test Product",
  handle = "test-product",
  vendor = "Test Vendor",
  productType = "Apparel",
  tags = [],
  variants = [],
  variantsHaveNextPage = false,
  variantsEndCursor = null,
} = {}) {
  return {
    id,
    title,
    handle,
    description: "A test product",
    vendor,
    productType,
    tags,
    status: "ACTIVE",
    featuredMedia: { image: { url: "https://cdn.shopify.com/test.png", altText: null } },
    options: [
      { id: "gid://shopify/ProductOption/1", name: "Color", values: [] },
      { id: "gid://shopify/ProductOption/2", name: "Size", values: [] },
    ],
    variants: {
      nodes: variants,
      pageInfo: { hasNextPage: variantsHaveNextPage, endCursor: variantsEndCursor },
    },
  };
}

export function productsPage(nodes, { hasNextPage = false, endCursor = null } = {}) {
  return { data: { products: { nodes, pageInfo: { hasNextPage, endCursor } } } };
}
