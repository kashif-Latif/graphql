import { toPrice, toInventory, normalizeText } from "../utils/normalize.js";

const COLOR_OPTION_NAMES = /^(colou?r|shade|colorway)$/i;
const SIZE_OPTION_NAMES = /^(size|age|age group|sizes)$/i;

/**
 * Pull the colour/size of a variant. selectedOptions is the source of truth;
 * the variant title ("Black / 1–2 Years (16)") is only a fallback for stores
 * that never named their options properly.
 */
function extractOptionValues(variant) {
  const selected = Array.isArray(variant.selectedOptions) ? variant.selectedOptions : [];
  let color = null;
  let size = null;

  for (const option of selected) {
    const name = String(option?.name || "");
    if (!color && COLOR_OPTION_NAMES.test(name.trim())) color = option.value ?? null;
    else if (!size && SIZE_OPTION_NAMES.test(name.trim())) size = option.value ?? null;
  }

  if (color === null && size === null && variant.title && variant.title !== "Default Title") {
    const parts = String(variant.title)
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      color = parts[0];
      size = parts[1];
    } else if (parts.length === 1) {
      size = parts[0];
    }
  }

  return { color, size };
}

export function normalizeVariant(variant) {
  if (!variant) return null;
  const { color, size } = extractOptionValues(variant);
  const price = toPrice(variant.price);
  const inventoryQuantity = toInventory(variant.inventoryQuantity);

  return {
    id: variant.id,
    title: variant.title ?? null,
    sku: variant.sku ?? null,
    color,
    size,
    price,
    compareAtPrice: toPrice(variant.compareAtPrice),
    inventoryQuantity,
    // availableForSale is Shopify's own answer; fall back to quantity.
    available:
      typeof variant.availableForSale === "boolean"
        ? variant.availableForSale
        : (inventoryQuantity ?? 0) > 0,
    selectedOptions: (variant.selectedOptions || []).map((option) => ({
      name: option?.name ?? null,
      value: option?.value ?? null,
    })),
  };
}

export function productUrl(handle) {
  return handle ? `/products/${handle}` : null;
}

/** Full normalisation of a Shopify product node (all variants kept). */
export function normalizeProduct(node) {
  if (!node) return null;
  const variants = (node.variants?.nodes || []).map(normalizeVariant).filter(Boolean);

  return {
    id: node.id,
    title: node.title ?? null,
    handle: node.handle ?? null,
    url: productUrl(node.handle),
    description: node.description ?? null,
    vendor: node.vendor ?? null,
    productType: node.productType ?? null,
    tags: Array.isArray(node.tags) ? node.tags : [],
    status: node.status ?? null,
    image: node.featuredMedia?.image?.url ?? null,
    imageAlt: node.featuredMedia?.image?.altText ?? null,
    options: (node.options || []).map((option) => ({
      id: option?.id ?? null,
      name: option?.name ?? null,
      values: option?.values || [],
    })),
    variants,
    variantsHaveNextPage: Boolean(node.variants?.pageInfo?.hasNextPage),
    variantsEndCursor: node.variants?.pageInfo?.endCursor ?? null,
  };
}

/**
 * The compact shape handed to the LLM. Only matching variants are included,
 * and no description/tags bulk is sent.
 */
export function toSearchResult(product, matchingVariants, { totalMatching } = {}) {
  const shown = matchingVariants.length;
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    url: product.url,
    image: product.image,
    vendor: product.vendor,
    productType: product.productType,
    matchingVariants: matchingVariants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      color: variant.color,
      size: variant.size,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      inventoryQuantity: variant.inventoryQuantity,
      available: variant.available,
      sku: variant.sku,
    })),
    // Told explicitly, so the model never implies these are all the options.
    ...(totalMatching && totalMatching > shown
      ? { moreMatchingVariants: totalMatching - shown }
      : {}),
  };
}

/** Shape returned to API clients (chat response `products` field). */
export function toClientProduct(product, variants) {
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    url: product.url,
    image: product.image,
    variants: variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      price: variant.price,
      available: variant.available,
    })),
  };
}

/** Short searchable blob used for loose keyword scoring in JS. */
export function productHaystack(product) {
  return normalizeText(
    [product.title, product.productType, product.vendor, (product.tags || []).join(" ")]
      .filter(Boolean)
      .join(" ")
  );
}
