import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveProductReference,
  rememberShownProducts,
  buildReferenceContext,
} from "../src/utils/productReferences.js";
import {
  loadThread,
  saveThread,
  appendMessage,
  recentMessages,
  updateSummary,
  clearThread,
} from "../src/services/memory.service.js";
import { extractProducts } from "../src/services/chat.service.js";

const shown = [
  { id: "gid://shopify/Product/1", title: "Soft Baby Towel", url: "/products/a" },
  { id: "gid://shopify/Product/2", title: "Hooded Baby Blanket", url: "/products/b" },
  { id: "gid://shopify/Product/3", title: "Baby Storage Organizer", url: "/products/c" },
];

function stateWithProducts() {
  const state = {
    threadId: "t",
    summary: "",
    messages: [],
    lastShownProducts: [],
    lastSelectedProductId: null,
    updatedAt: Date.now(),
  };
  return rememberShownProducts(state, shown);
}

test("ordinal references resolve to the right product", () => {
  const state = stateWithProducts();
  assert.equal(resolveProductReference("Does the second one have size 2-3?", state), "gid://shopify/Product/2");
  assert.equal(resolveProductReference("Is the first product available?", state), "gid://shopify/Product/1");
  assert.equal(resolveProductReference("show me the third", state), "gid://shopify/Product/3");
  assert.equal(resolveProductReference("what about number 2", state), "gid://shopify/Product/2");
  assert.equal(resolveProductReference("the last one", state), "gid://shopify/Product/3");
});

test("title mentions resolve without an ordinal", () => {
  const state = stateWithProducts();
  assert.equal(
    resolveProductReference("does the hooded baby blanket come in pink?", state),
    "gid://shopify/Product/2"
  );
});

test("demonstratives fall back to the currently discussed product", () => {
  const state = stateWithProducts();
  assert.equal(resolveProductReference("is that available?", state), null);
  state.lastSelectedProductId = "gid://shopify/Product/2";
  assert.equal(resolveProductReference("is that available?", state), "gid://shopify/Product/2");
});

test("a fresh search request does not resolve to an old product", () => {
  const state = stateWithProducts();
  assert.equal(resolveProductReference("show me pink products under 1000", state), null);
});

test("the reference block carries positions and ids to the model", () => {
  const context = buildReferenceContext(stateWithProducts());
  assert.match(context, /1\. Soft Baby Towel — gid:\/\/shopify\/Product\/1/);
  assert.match(context, /2\. Hooded Baby Blanket/);
  assert.match(context, /Do not run a new broad search/);
});

test("memory keeps only the last 5 messages plus a rolling summary", async () => {
  await clearThread("thread-memory");
  const state = await loadThread("thread-memory");
  for (let i = 0; i < 14; i += 1) {
    appendMessage(state, i % 2 === 0 ? "user" : "assistant", `message ${i}`);
  }
  updateSummary(state);
  await saveThread(state);

  const reloaded = await loadThread("thread-memory");
  assert.equal(reloaded.messages.length, 5);
  assert.equal(recentMessages(reloaded).length, 5);
  assert.match(reloaded.summary, /message 0/);
  assert.match(reloaded.messages.at(-1).content, /message 13/);
});

test("structured products are extracted from tool output for the API response", () => {
  const toolPayload = JSON.stringify({
    products: [
      {
        id: "gid://shopify/Product/1",
        title: "Soft Baby Towel",
        handle: "soft-baby-towel",
        url: "/products/soft-baby-towel",
        image: "https://cdn.shopify.com/x.png",
        matchingVariants: [
          { id: "gid://shopify/ProductVariant/1", title: "Pink / 30*30", price: 399, available: true },
        ],
      },
    ],
    count: 1,
  });

  const products = extractProducts([
    { getType: () => "human", content: "pink towel" },
    { getType: () => "tool", content: toolPayload },
    { getType: () => "ai", content: "I found a pink towel." },
  ]);

  assert.equal(products.length, 1);
  assert.equal(products[0].title, "Soft Baby Towel");
  assert.equal(products[0].variants[0].price, 399);
  assert.equal(products[0].variants[0].available, true);
});

test("failed tool results never become products", () => {
  const products = extractProducts([
    { getType: () => "tool", content: JSON.stringify({ error: true, message: "That lookup failed." }) },
    { getType: () => "tool", content: "not json" },
  ]);
  assert.deepEqual(products, []);
});
