import * as z from "zod";
import { env } from "../config/env.js";
import { shopifyGraphQL } from "../shopify/client.js";
import { GET_PRODUCT_QUERY } from "../shopify/queries.js";
import { fetchAllVariants } from "../shopify/pagination.js";
import { normalizeProduct, toSearchResult } from "../shopify/normalizeProduct.js";
import { searchProductsCore } from "../shopify/productSearch.js";
import { variantMatchesFilters } from "../shopify/filters.js";
import { colorMatches, sizeMatches } from "../utils/normalize.js";
import { ValidationError, NotFoundError } from "../utils/errors.js";

/* ------------------------------------------------------------------ *
 * Schemas — shared by the LangChain tools and the REST endpoints.
 * ------------------------------------------------------------------ */

export const searchFiltersSchema = z.object({
  query: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  productType: z.string().max(100).optional(),
  vendor: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  size: z.string().max(50).optional(),
  age: z.number().min(0).max(18).optional(),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  inStock: z.boolean().optional(),
  limit: z.number().int().min(1).max(5).default(5),
});

export const getProductSchema = z.object({
  productId: z.string().min(1),
});

export const getProductVariantsSchema = z.object({
  productId: z.string().min(1),
  color: z.string().max(50).optional(),
  size: z.string().max(50).optional(),
});

export const checkInventorySchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional(),
  color: z.string().max(50).optional(),
  size: z.string().max(50).optional(),
});

export const compareProductsSchema = z.object({
  productIds: z.array(z.string().min(1)).min(2).max(4),
  requirement: z.string().max(300).optional(),
});

/* ------------------------------------------------------------------ *
 * ID handling
 * ------------------------------------------------------------------ */

/** Upper bound on variants returned by get_product / compare_products. */
const MAX_DETAIL_VARIANTS = 25;

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;

export function toProductGid(value) {
  const raw = String(value || "").trim();
  if (PRODUCT_GID.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Product/${raw}`;
  throw new ValidationError(`Invalid Shopify product id: ${raw.slice(0, 60)}`);
}

export function isVariantGid(value) {
  return VARIANT_GID.test(String(value || "").trim());
}

/* ------------------------------------------------------------------ *
 * Services
 * ------------------------------------------------------------------ */

/**
 * THE reusable search entry point. Used by both the REST endpoint and the
 * LangChain search_products tool. Never duplicated.
 */
export async function searchProducts(rawFilters, meta = {}) {
  const filters = searchFiltersSchema.parse(rawFilters ?? {});
  if (
    Number.isFinite(filters.minPrice) &&
    Number.isFinite(filters.maxPrice) &&
    filters.minPrice > filters.maxPrice
  ) {
    throw new ValidationError("minPrice cannot be greater than maxPrice");
  }
  return searchProductsCore(filters, meta);
}

/** Detailed information for a product whose GID is already known. */
export async function getProduct(rawInput, meta = {}) {
  const { productId } = getProductSchema.parse(rawInput);
  const id = toProductGid(productId);

  const { data } = await shopifyGraphQL(
    GET_PRODUCT_QUERY,
    { id, variantsFirst: env.search.variantPageSize },
    { operationName: "GetProduct", requestId: meta.requestId }
  );

  if (!data.product) throw new NotFoundError("That product could not be found in the store.");

  const product = normalizeProduct(data.product);
  let variants = product.variants;

  if (product.variantsHaveNextPage) {
    const full = await fetchAllVariants({ productId: id, requestId: meta.requestId });
    if (full.variants.length) variants = full.variants;
  }

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    url: product.url,
    image: product.image,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    status: product.status,
    description: (product.description || "").slice(0, 300),
    options: product.options,
    priceRange: priceRange(variants),
    variantCount: variants.length,
    // Bounded so a 60-variant product cannot blow the model's context.
    variants: variants.slice(0, MAX_DETAIL_VARIANTS).map(compactVariant),
    variantsTruncated: variants.length > MAX_DETAIL_VARIANTS,
  };
}

/** Variants of a known product, paginated, optionally filtered. */
export async function getProductVariants(rawInput, meta = {}) {
  const input = getProductVariantsSchema.parse(rawInput);
  const id = toProductGid(input.productId);

  const { product, variants, truncated } = await fetchAllVariants({
    productId: id,
    requestId: meta.requestId,
  });

  if (!product) throw new NotFoundError("That product could not be found in the store.");

  const filtered = variants.filter(
    (variant) =>
      (!input.color || colorMatches(variant.color ?? variant.title, input.color)) &&
      (!input.size || sizeMatches(variant.size ?? variant.title, input.size))
  );

  return {
    productId: product.id,
    title: product.title,
    handle: product.handle,
    url: product.url,
    options: product.options,
    availableColors: distinct(variants.filter((v) => v.available).map((v) => v.color)),
    availableSizes: distinct(variants.filter((v) => v.available).map((v) => v.size)),
    allColors: distinct(variants.map((v) => v.color)),
    allSizes: distinct(variants.map((v) => v.size)),
    matchedCount: filtered.length,
    variants: filtered.map(compactVariant),
    variantListTruncated: truncated,
  };
}

/**
 * Live inventory. Always re-queries Shopify — never trusts conversation state.
 */
export async function checkInventory(rawInput, meta = {}) {
  const input = checkInventorySchema.parse(rawInput);
  const id = toProductGid(input.productId);

  if (input.variantId && !isVariantGid(input.variantId)) {
    throw new ValidationError(`Invalid Shopify variant id: ${String(input.variantId).slice(0, 60)}`);
  }

  const { product, variants } = await fetchAllVariants({
    productId: id,
    requestId: meta.requestId,
  });

  if (!product) throw new NotFoundError("That product could not be found in the store.");

  let selected = variants;
  if (input.variantId) selected = selected.filter((v) => v.id === input.variantId);
  if (input.color) selected = selected.filter((v) => colorMatches(v.color ?? v.title, input.color));
  if (input.size) selected = selected.filter((v) => sizeMatches(v.size ?? v.title, input.size));

  const inStock = selected.filter((v) => v.available && (v.inventoryQuantity ?? 0) > 0);

  return {
    productId: product.id,
    title: product.title,
    url: product.url,
    requested: {
      variantId: input.variantId ?? null,
      color: input.color ?? null,
      size: input.size ?? null,
    },
    matchedVariantCount: selected.length,
    anyInStock: inStock.length > 0,
    variants: selected.map((variant) => ({
      id: variant.id,
      title: variant.title,
      color: variant.color,
      size: variant.size,
      price: variant.price,
      available: variant.available && (variant.inventoryQuantity ?? 0) > 0,
      stockLevel: stockLevel(variant.inventoryQuantity),
    })),
    // Alternatives help the assistant offer a genuine substitute.
    otherAvailableOptions:
      inStock.length === 0
        ? variants
            .filter((v) => v.available && (v.inventoryQuantity ?? 0) > 0)
            .slice(0, 5)
            .map((v) => ({ id: v.id, title: v.title, color: v.color, size: v.size, price: v.price }))
        : [],
  };
}

/** Structured side-by-side data; the agent writes the prose. */
export async function compareProducts(rawInput, meta = {}) {
  const input = compareProductsSchema.parse(rawInput);
  const unique = [...new Set(input.productIds.map(toProductGid))];

  const products = await Promise.all(
    unique.map(async (productId) => {
      try {
        return await getProduct({ productId }, meta);
      } catch (error) {
        return { id: productId, error: error.publicMessage || "Product unavailable" };
      }
    })
  );

  return {
    requirement: input.requirement ?? null,
    products: products.map((product) =>
      product.error
        ? product
        : {
            id: product.id,
            title: product.title,
            url: product.url,
            image: product.image,
            vendor: product.vendor,
            productType: product.productType,
            priceRange: product.priceRange,
            colors: distinct(product.variants.map((v) => v.color)),
            sizes: distinct(product.variants.map((v) => v.size)),
            inStockVariantCount: product.variants.filter((v) => v.available).length,
            variantCount: product.variantCount,
          }
    ),
  };
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function compactVariant(variant) {
  return {
    id: variant.id,
    title: variant.title,
    sku: variant.sku,
    color: variant.color,
    size: variant.size,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    available: variant.available && (variant.inventoryQuantity ?? 0) > 0,
    stockLevel: stockLevel(variant.inventoryQuantity),
  };
}

/**
 * Exact quantities stay server-side; the agent only needs a coarse signal.
 */
function stockLevel(quantity) {
  if (typeof quantity !== "number") return "unknown";
  if (quantity <= 0) return "out_of_stock";
  if (quantity <= 3) return "low";
  return "in_stock";
}

function distinct(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}

function priceRange(variants) {
  const prices = variants.map((v) => v.price).filter((p) => typeof p === "number");
  if (!prices.length) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export { toSearchResult, variantMatchesFilters };
