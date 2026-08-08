import { defineTool } from "./defineTool.js";
import { checkInventory, checkInventorySchema } from "../services/product.service.js";

export const checkInventoryTool = defineTool({
  name: "check_inventory",
  description: `Check LIVE availability for a product, or for one specific colour/size/variant of it.
Always call this before telling a customer that something is in stock — never rely on
availability mentioned earlier in the conversation, it may be stale.`,
  schema: checkInventorySchema,
  run: (input, meta) => checkInventory(input, meta),
  count: (result) => result.matchedVariantCount,
});
