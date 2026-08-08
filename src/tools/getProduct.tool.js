import { defineTool } from "./defineTool.js";
import { getProduct, getProductSchema } from "../services/product.service.js";

export const getProductTool = defineTool({
  name: "get_product",
  description: `Get full details for ONE product whose Shopify product id (gid://shopify/Product/...) is already known.
Use this instead of searching again when the customer refers to a product you have already shown.`,
  schema: getProductSchema,
  run: async (input, meta) => ({ product: await getProduct(input, meta) }),
  count: (result) => result.product?.variantCount ?? null,
});
