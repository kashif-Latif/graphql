import { defineTool } from "./defineTool.js";
import { compareProducts, compareProductsSchema } from "../services/product.service.js";

export const compareProductsTool = defineTool({
  name: "compare_products",
  description: `Compare 2-4 products whose Shopify product ids are already known.
Returns live price ranges, colours, sizes and stock counts side by side so you can explain the differences.`,
  schema: compareProductsSchema,
  run: (input, meta) => compareProducts(input, meta),
  count: (result) => result.products.length,
});
