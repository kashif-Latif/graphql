import { defineTool } from "./defineTool.js";
import { getDiscounts, getDiscountsSchema } from "../services/discount.service.js";

export const getDiscountsTool = defineTool({
  name: "get_discounts",
  description: `List the store's current promotions, sales and discount codes, live from Shopify.
Use for questions like "any offers?", "do you have a discount code?", "is there free shipping?".
Each result carries Shopify's own summary sentence — repeat it, never invent terms or amounts.`,
  schema: getDiscountsSchema,
  run: (input, meta) => getDiscounts(input, meta),
  count: (result) => result.count,
});
