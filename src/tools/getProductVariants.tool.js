import { defineTool } from "./defineTool.js";
import { getProductVariants, getProductVariantsSchema } from "../services/product.service.js";

export const getProductVariantsTool = defineTool({
  name: "get_product_variants",
  description: `List the sizes, colours and other variants of ONE known product (all variant pages are followed).
Use for questions like "what sizes does it come in?", "does that come in pink?", "what colours are available?".
Optional colour/size narrow the returned list.`,
  schema: getProductVariantsSchema,
  run: (input, meta) => getProductVariants(input, meta),
  count: (result) => result.matchedCount,
});
