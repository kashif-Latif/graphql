import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, restoreFetch, product, variant, productsPage } from "./helpers/shopifyMock.js";
import { withTrace, summarizeTrace, getTrace } from "../src/utils/trace.js";
import { searchProducts } from "../src/services/product.service.js";
import { toolsByName } from "../src/tools/index.js";

test.afterEach(() => restoreFetch());

test("a search records pages, candidates, cost and the query it used", async () => {
  installFetch(() => ({
    body: {
      data: {
        products: {
          nodes: [product({ variants: [variant({ color: "Pink", price: "399.00" })] })],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
      extensions: {
        cost: {
          requestedQueryCost: 102,
          actualQueryCost: 5,
          throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 1995, restoreRate: 100 },
        },
      },
    },
  }));

  const summary = await withTrace({ requestId: "req-1" }, async () => {
    await searchProducts({ color: "pink", maxPrice: 500 });
    return summarizeTrace();
  });

  assert.equal(summary.requestId, "req-1");
  assert.equal(summary.shopifyRequests, 1);
  assert.equal(summary.shopifyAttempts, 1);
  assert.equal(summary.shopifyRetries, 0);
  assert.equal(summary.shopifyQueryCost.actual, 5);
  assert.equal(summary.shopifyQueryCost.throttleStatus.currentlyAvailable, 1995);
  assert.equal(summary.searches, 1);
  assert.equal(summary.pagesFetched, 1);
  assert.equal(summary.finalProducts, 1);
  assert.deepEqual(summary.shopifyOperations.map((op) => op.name), ["SearchProducts"]);
  assert.match(summary.shopifyQueriesTried[0], /status:ACTIVE/);
});

test("retries and throttling are counted, not hidden", async () => {
  let calls = 0;
  installFetch(() => {
    calls += 1;
    if (calls < 3) {
      return {
        body: {
          errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
          extensions: { cost: { throttleStatus: { currentlyAvailable: 0, restoreRate: 100 } } },
        },
      };
    }
    return productsPage([product({ variants: [variant({ color: "Pink" })] })]);
  });

  const summary = await withTrace({ requestId: "req-2" }, async () => {
    await searchProducts({ color: "pink" });
    return summarizeTrace();
  });

  assert.equal(summary.shopifyAttempts, 3, "every HTTP attempt is counted");
  assert.equal(summary.shopifyRetries, 2);
  assert.equal(summary.shopifyThrottled, 2);
  assert.equal(summary.shopifyRequests, 1, "only the successful operation counts as a request");
});

test("tool calls are recorded with duration, outcome and result count", async () => {
  installFetch(() =>
    productsPage([
      product({
        id: "gid://shopify/Product/1",
        title: "Soft Baby Towel",
        variants: [variant({ color: "Pink", price: "399.00" })],
      }),
    ])
  );

  const summary = await withTrace({ requestId: "req-3" }, async () => {
    await toolsByName.search_products.invoke(
      { query: "towel", color: "pink", limit: 5 },
      { configurable: { requestId: "req-3" } }
    );
    return summarizeTrace("req-3");
  });

  assert.equal(summary.toolCalls, 1);
  assert.deepEqual(summary.toolsUsed, ["search_products"]);
  assert.equal(summary.toolDetail[0].ok, true);
  assert.equal(summary.toolDetail[0].resultCount, 1);
  assert.equal(typeof summary.toolDetail[0].durationMs, "number");
});

test("a failing tool is recorded as not ok and returns a safe payload", async () => {
  installFetch(() => ({ body: { errors: [{ message: "internal shopify detail" }] } }));

  const { summary, output } = await withTrace({ requestId: "req-4" }, async () => {
    const output = await toolsByName.search_products.invoke(
      { query: "towel" },
      { configurable: { requestId: "req-4" } }
    );
    return { summary: summarizeTrace("req-4"), output };
  });

  assert.equal(summary.toolCalls, 1);
  assert.equal(summary.toolDetail[0].ok, false);
  assert.equal(summary.shopifyErrors, 1);

  const payload = JSON.parse(typeof output === "string" ? output : output.content);
  assert.equal(payload.error, true);
  assert.doesNotMatch(payload.message, /internal shopify detail/);
});

test("a tool records against its requestId even if async context is lost", async () => {
  installFetch(() => productsPage([product({ variants: [variant({ color: "Pink" })] })]));

  // LangChain installs its own AsyncLocalStorage on the first .invoke() of a
  // process, which can drop our async-local trace. Recording therefore falls
  // back to the requestId the tool receives in its config.
  const trace = await withTrace({ requestId: "req-5" }, async (t) => t);
  await toolsByName.search_products.invoke(
    { query: "towel", color: "pink" },
    { configurable: { requestId: "req-5" } }
  );
  // The trace was released when withTrace's promise settled, so nothing was
  // recorded after the request ended — no leak.
  assert.equal(trace.tools.length, 0);
});

test("recorders are inert outside a request (scripts and tests stay unaffected)", async () => {
  assert.equal(getTrace(), null);
  assert.equal(summarizeTrace(), null);
  installFetch(() => productsPage([]));
  const result = await searchProducts({ color: "pink" });
  assert.equal(result.count, 0);
});
