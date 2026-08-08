/**
 * Proves the Shopify path works with NO LLM involved.
 *   node scripts/smokeSearch.js
 */
import { shopifyGraphQL } from "../src/shopify/client.js";
import { SHOP_PROBE_QUERY } from "../src/shopify/queries.js";
import { searchProducts } from "../src/services/product.service.js";

const CASES = [
  { label: "pink baby towel under 500", filters: { query: "baby towel", color: "pink", maxPrice: 500, inStock: true } },
  { label: "black clothes for a 2 year old under 1500", filters: { query: "clothes", color: "black", age: 2, maxPrice: 1500, inStock: true } },
  { label: "pink products under 1000", filters: { color: "pink", maxPrice: 1000, inStock: true } },
  { label: "products for 0-6 months", filters: { age: 0.25 } },
  { label: "between 500 and 1000", filters: { minPrice: 500, maxPrice: 1000 } },
];

const { data } = await shopifyGraphQL(SHOP_PROBE_QUERY, {}, { operationName: "ShopProbe" });
console.log(`\nConnected to: ${data.shop?.name} (${data.shop?.myshopifyDomain}) ${data.shop?.currencyCode}\n`);

for (const testCase of CASES) {
  const result = await searchProducts(testCase.filters);
  console.log(`── ${testCase.label} → ${result.count} product(s)`);
  for (const product of result.products) {
    console.log(`   • ${product.title}  ${product.url}`);
    for (const variant of product.matchingVariants.slice(0, 3)) {
      console.log(
        `       ${variant.title} | color=${variant.color} size=${variant.size} | Rs ${variant.price} | qty=${variant.inventoryQuantity}`
      );
    }
  }
  console.log("");
}
