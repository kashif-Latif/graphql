import * as z from "zod";
import {
  searchProducts,
  getProduct,
  getProductVariants,
  checkInventory,
} from "../services/product.service.js";

const numeric = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}, z.number());

const boolish = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  if (value === "true" || value === true || value === "1") return true;
  if (value === "false" || value === false || value === "0") return false;
  return value;
}, z.boolean());

/** Query-string schema for GET /api/products/search (no LLM involved). */
const searchQuerySchema = z.object({
  query: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  productType: z.string().max(100).optional(),
  vendor: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  size: z.string().max(50).optional(),
  age: numeric.optional(),
  minPrice: numeric.optional(),
  maxPrice: numeric.optional(),
  inStock: boolish.optional(),
  limit: numeric.optional(),
});

export async function searchProductsController(req, res, next) {
  try {
    const filters = searchQuerySchema.parse(req.query);
    const result = await searchProducts(filters, { requestId: req.requestId });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getProductController(req, res, next) {
  try {
    const product = await getProduct({ productId: req.params.productId }, { requestId: req.requestId });
    res.json({ success: true, product });
  } catch (error) {
    next(error);
  }
}

export async function getProductVariantsController(req, res, next) {
  try {
    const result = await getProductVariants(
      {
        productId: req.params.productId,
        color: req.query.color,
        size: req.query.size,
      },
      { requestId: req.requestId }
    );
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function checkInventoryController(req, res, next) {
  try {
    const result = await checkInventory(
      {
        productId: req.params.productId,
        variantId: req.query.variantId,
        color: req.query.color,
        size: req.query.size,
      },
      { requestId: req.requestId }
    );
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}
