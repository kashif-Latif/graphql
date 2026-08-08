import { searchProductsTool } from "./searchProducts.tool.js";
import { getProductTool } from "./getProduct.tool.js";
import { getProductVariantsTool } from "./getProductVariants.tool.js";
import { checkInventoryTool } from "./checkInventory.tool.js";
import { compareProductsTool } from "./compareProducts.tool.js";
import { getDiscountsTool } from "./getDiscounts.tool.js";

/**
 * The complete, closed set of capabilities the LLM has.
 * There is deliberately NO tool that executes arbitrary GraphQL.
 */
export const productTools = [
  searchProductsTool,
  getProductTool,
  getProductVariantsTool,
  checkInventoryTool,
  compareProductsTool,
  getDiscountsTool,
];

export const toolsByName = Object.fromEntries(productTools.map((t) => [t.name, t]));

export {
  searchProductsTool,
  getProductTool,
  getProductVariantsTool,
  checkInventoryTool,
  compareProductsTool,
  getDiscountsTool,
};
