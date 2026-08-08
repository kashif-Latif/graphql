import { defineTool } from "./defineTool.js";
import { searchProducts, searchFiltersSchema } from "../services/product.service.js";

export const SEARCH_PRODUCTS_DESCRIPTION = `Search the live Shopify catalogue for products.
Use this whenever the customer wants to discover or browse products.
Pass structured filters — never write GraphQL.
Colour, size, age, price and stock filters are applied to the SAME variant, so
the result only contains variants that satisfy every condition.
Returns at most 5 products with their matching variants only.`;

export const searchProductsTool = defineTool({
  name: "search_products",
  description: SEARCH_PRODUCTS_DESCRIPTION,
  schema: searchFiltersSchema,
  run: async (input, meta) => {
    const result = await searchProducts(input, meta);
    return { products: result.products, count: result.count };
  },
  count: (result) => result.count,
});
