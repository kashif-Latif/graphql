import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, restoreFetch, product, variant, productsPage } from "./helpers/shopifyMock.js";
import { searchProducts, getProductVariants, checkInventory, getProduct } from "../src/services/product.service.js";
import { ShopifyError, ShopifyThrottledError, ValidationError, NotFoundError } from "../src/utils/errors.js";
import { env } from "../src/config/env.js";

test.afterEach(() => restoreFetch());

const isSearch = (query) => query.includes("query SearchProducts");
const isVariants = (query) => query.includes("query GetProductVariants");
const isProduct = (query) => query.includes("query GetProduct(");

test("finds a matching variant on the first page and stops paginating", async () => {
  let calls = 0;
  installFetch(({ query }) => {
    assert.ok(isSearch(query));
    calls += 1;
    return productsPage(
      [
        product({
          id: "gid://shopify/Product/1",
          title: "Soft Baby Towel",
          handle: "soft-baby-towel",
          variants: [
            variant({ color: "Orange", size: "30*30 Inches", price: "399.00", inventoryQuantity: 1 }),
            variant({ color: "Pink", size: "30*30 Inches", price: "399.00", inventoryQuantity: 1 }),
          ],
        }),
      ],
      { hasNextPage: true, endCursor: "c1" }
    );
  });

  const result = await searchProducts({
    query: "baby towel",
    color: "pink",
    maxPrice: 500,
    inStock: true,
    limit: 1,
  });

  assert.equal(calls, 1, "must stop as soon as the limit is satisfied");
  assert.equal(result.count, 1);
  assert.equal(result.products[0].title, "Soft Baby Towel");
  assert.equal(result.products[0].url, "/products/soft-baby-towel");
  assert.equal(result.products[0].matchingVariants.length, 1, "only matching variants are returned");
  assert.equal(result.products[0].matchingVariants[0].color, "Pink");
  assert.equal(result.products[0].matchingVariants[0].price, 399);
});

test("follows product pagination when page 1 has no match", async () => {
  let calls = 0;
  installFetch(({ variables }) => {
    calls += 1;
    if (!variables.after) {
      return productsPage(
        [product({ id: "gid://shopify/Product/1", title: "Blue Towel", variants: [variant({ color: "Blue" })] })],
        { hasNextPage: true, endCursor: "cursor-1" }
      );
    }
    assert.equal(variables.after, "cursor-1", "next page must use endCursor");
    return productsPage(
      [
        product({
          id: "gid://shopify/Product/2",
          title: "Pink Towel",
          variants: [variant({ color: "Pink", price: "399.00" })],
        }),
      ],
      { hasNextPage: false, endCursor: null }
    );
  });

  const result = await searchProducts({ color: "pink", maxPrice: 500 });
  assert.equal(calls, 2);
  assert.equal(result.count, 1);
  assert.equal(result.products[0].title, "Pink Towel");
});

test("pagination is bounded by MAX_PAGES_PER_SEARCH", async () => {
  let calls = 0;
  installFetch(() => {
    calls += 1;
    return productsPage([product({ variants: [variant({ color: "Blue" })] })], {
      hasNextPage: true,
      endCursor: `c${calls}`,
    });
  });

  const result = await searchProducts({ color: "chartreuse" });
  assert.equal(result.count, 0);
  assert.equal(calls, env.search.maxPages, "never loops past the page cap");
});

test("returns nothing rather than a near-miss when no variant matches", async () => {
  installFetch(() =>
    productsPage([
      product({
        variants: [
          variant({ color: "Pink", size: "5", price: "2000.00" }),
          variant({ color: "Black", size: "2", price: "900.00" }),
        ],
      }),
    ])
  );

  const result = await searchProducts({ color: "pink", size: "2", maxPrice: 1000 });
  assert.equal(result.count, 0);
  assert.deepEqual(result.products, []);
});

test("follows nested variant pagination when the first variant page misses", async () => {
  let variantCalls = 0;
  installFetch(({ query, variables }) => {
    if (isSearch(query)) {
      return productsPage([
        product({
          id: "gid://shopify/Product/9",
          title: "Big Catalogue Product",
          variants: [variant({ color: "Blue", price: "499.00" })],
          variantsHaveNextPage: true,
          variantsEndCursor: "v1",
        }),
      ]);
    }
    assert.ok(isVariants(query));
    variantCalls += 1;
    if (variantCalls === 1) {
      return {
        data: {
          product: {
            id: "gid://shopify/Product/9",
            title: "Big Catalogue Product",
            handle: "big",
            options: [],
            variants: {
              nodes: [variant({ color: "Blue", price: "499.00" })],
              pageInfo: { hasNextPage: true, endCursor: "v1" },
            },
          },
        },
      };
    }
    assert.equal(variables.after, "v1");
    return {
      data: {
        product: {
          id: "gid://shopify/Product/9",
          title: "Big Catalogue Product",
          handle: "big",
          options: [],
          variants: {
            nodes: [variant({ color: "Pink", price: "499.00" })],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    };
  });

  const result = await searchProducts({ color: "pink", maxPrice: 500 });
  assert.equal(variantCalls, 2, "variant cursor is followed");
  assert.equal(result.count, 1);
  assert.equal(result.products[0].matchingVariants[0].color, "Pink");
});

test("surfaces Shopify GraphQL errors as internal errors, not to the customer", async () => {
  installFetch(() => ({
    body: { errors: [{ message: "Field 'nope' doesn't exist on type 'Product'" }] },
  }));

  await assert.rejects(
    () => searchProducts({ query: "towel" }),
    (error) => {
      assert.ok(error instanceof ShopifyError);
      assert.match(error.message, /Field 'nope'/);
      assert.equal(error.publicMessage, "The store catalog is temporarily unavailable.");
      return true;
    }
  );
});

test("throttling is retried and then reported as a throttle error", async () => {
  let calls = 0;
  installFetch(() => {
    calls += 1;
    return {
      body: {
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 0, restoreRate: 50 } } },
      },
    };
  });

  await assert.rejects(
    () => searchProducts({ query: "towel" }),
    (error) => error instanceof ShopifyThrottledError
  );
  assert.ok(calls > 1, "throttled requests are retried with backoff");
});

test("malformed Shopify responses are handled safely", async () => {
  installFetch(() => new Response("<html>gateway</html>", { status: 200 }));
  await assert.rejects(() => searchProducts({ query: "towel" }), ShopifyError);
});

test("invalid product ids are rejected before any Shopify call", async () => {
  installFetch(() => {
    throw new Error("Shopify must not be called");
  });
  await assert.rejects(() => getProduct({ productId: "'; DROP TABLE" }), ValidationError);
  await assert.rejects(() => checkInventory({ productId: "nonsense" }), ValidationError);
});

test("missing products produce a clean not-found", async () => {
  installFetch(({ query }) => {
    assert.ok(isProduct(query) || isVariants(query));
    return { data: { product: null } };
  });
  await assert.rejects(
    () => getProduct({ productId: "gid://shopify/Product/999999" }),
    NotFoundError
  );
});

test("get_product_variants paginates and summarises options", async () => {
  let page = 0;
  installFetch(({ query }) => {
    assert.ok(isVariants(query));
    page += 1;
    const last = page === 2;
    return {
      data: {
        product: {
          id: "gid://shopify/Product/1",
          title: "Soft Baby Towel",
          handle: "soft-baby-towel",
          options: [{ id: "o1", name: "Color", values: ["Pink", "Blue"] }],
          variants: {
            nodes: last
              ? [variant({ color: "Blue", size: "30*30 Inches", inventoryQuantity: 0 })]
              : [variant({ color: "Pink", size: "30*30 Inches", inventoryQuantity: 2 })],
            pageInfo: { hasNextPage: !last, endCursor: last ? null : "v1" },
          },
        },
      },
    };
  });

  const result = await getProductVariants({ productId: "gid://shopify/Product/1" });
  assert.equal(page, 2);
  assert.deepEqual(result.allColors, ["Pink", "Blue"]);
  assert.deepEqual(result.availableColors, ["Pink"], "out-of-stock colours are not advertised");
});

test("check_inventory never reports zero-stock items as available", async () => {
  installFetch(() => ({
    data: {
      product: {
        id: "gid://shopify/Product/1",
        title: "Soft Baby Towel",
        handle: "soft-baby-towel",
        options: [],
        variants: {
          nodes: [
            variant({ color: "Pink", size: "30*30 Inches", inventoryQuantity: 0 }),
            variant({ color: "Blue", size: "30*30 Inches", inventoryQuantity: 4 }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  }));

  const result = await checkInventory({ productId: "gid://shopify/Product/1", color: "pink" });
  assert.equal(result.anyInStock, false);
  assert.equal(result.variants[0].available, false);
  assert.equal(result.variants[0].stockLevel, "out_of_stock");
  assert.equal(result.otherAvailableOptions.length, 1, "offers a genuine alternative");
  assert.equal(result.otherAvailableOptions[0].color, "Blue");
});

test("exact quantities are not leaked to the agent, only a coarse level", async () => {
  installFetch(() => ({
    data: {
      product: {
        id: "gid://shopify/Product/1",
        title: "T",
        handle: "t",
        options: [],
        variants: {
          nodes: [variant({ color: "Pink", inventoryQuantity: 42 })],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  }));
  const result = await checkInventory({ productId: "gid://shopify/Product/1" });
  assert.equal(result.variants[0].stockLevel, "in_stock");
  assert.equal(result.variants[0].inventoryQuantity, undefined);
});

test("the limit is capped at 5 products regardless of what is requested", async () => {
  installFetch(() =>
    productsPage(
      Array.from({ length: 20 }, (_, i) =>
        product({ id: `gid://shopify/Product/${i}`, variants: [variant({ color: "Pink" })] })
      )
    )
  );
  const result = await searchProducts({ color: "pink", limit: 5 });
  assert.equal(result.count, 5);
  await assert.rejects(() => searchProducts({ color: "pink", limit: 50 }));
});

test("minPrice above maxPrice is rejected", async () => {
  await assert.rejects(() => searchProducts({ minPrice: 2000, maxPrice: 500 }), ValidationError);
});
