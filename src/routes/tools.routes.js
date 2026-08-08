import { Router } from "express";
import { env } from "../config/env.js";
import { toolRateLimit } from "../middleware/rateLimit.js";
import {
  searchProducts,
  getProduct,
  getProductVariants,
  checkInventory,
  compareProducts,
} from "../services/product.service.js";
import { getDiscounts } from "../services/discount.service.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * Development-only tool tester. Calls the SERVICE behind each tool (no LLM),
 * so tool payloads can be exercised directly. Disabled unless
 * ENABLE_TOOL_TESTER=true, and always disabled in production by default.
 */
const HANDLERS = {
  search_products: searchProducts,
  get_product: getProduct,
  get_product_variants: getProductVariants,
  check_inventory: checkInventory,
  compare_products: compareProducts,
  get_discounts: getDiscounts,
};

export const toolsRouter = Router();

toolsRouter.use((req, res, next) => {
  if (!env.enableToolTester) {
    return res
      .status(404)
      .json({ success: false, error: { code: "not_found", message: "Endpoint not found" } });
  }
  next();
});

toolsRouter.get("/", (req, res) => {
  res.json({ success: true, tools: Object.keys(HANDLERS) });
});

toolsRouter.post("/:toolName", toolRateLimit, async (req, res, next) => {
  try {
    const handler = HANDLERS[req.params.toolName];
    if (!handler) throw new NotFoundError(`Unknown tool: ${req.params.toolName}`);
    const result = await handler(req.body ?? {}, { requestId: req.requestId });
    res.json({ success: true, tool: req.params.toolName, result });
  } catch (error) {
    next(error);
  }
});
