import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, restoreFetch } from "./helpers/shopifyMock.js";
import {
  getDiscounts,
  isCurrentlyRunning,
  clearDiscountCache,
} from "../src/services/discount.service.js";
import { toolsByName } from "../src/tools/index.js";
import { ShopifyError } from "../src/utils/errors.js";

test.beforeEach(() => clearDiscountCache());
test.afterEach(() => restoreFetch());

function discountsPage(nodes, { hasNextPage = false, endCursor = null } = {}) {
  return { data: { discountNodes: { nodes, pageInfo: { hasNextPage, endCursor } } } };
}

const freeShipping = {
  id: "gid://shopify/DiscountAutomaticNode/1296416964655",
  discount: {
    __typename: "DiscountAutomaticFreeShipping",
    title: "Free Shipping Above Rs. 3,000",
    status: "ACTIVE",
    startsAt: "2026-07-28T08:32:06Z",
    endsAt: null,
    summary: "Free shipping on all products • Minimum purchase of Rs3,000.00 • For all countries",
  },
};

const codeDiscount = {
  id: "gid://shopify/DiscountCodeNode/2",
  discount: {
    __typename: "DiscountCodeBasic",
    title: "Eid Sale",
    status: "ACTIVE",
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2030-01-01T00:00:00Z",
    summary: "20% off all products",
    codes: { nodes: [{ code: "EID20" }] },
  },
};

const expired = {
  id: "gid://shopify/DiscountAutomaticNode/3",
  discount: {
    __typename: "DiscountAutomaticBasic",
    title: "Last Year Sale",
    status: "ACTIVE",
    startsAt: "2020-01-01T00:00:00Z",
    endsAt: "2020-02-01T00:00:00Z",
    summary: "10% off",
  },
};

const disabled = {
  id: "gid://shopify/DiscountAutomaticNode/4",
  discount: {
    __typename: "DiscountAutomaticBasic",
    title: "Paused Promo",
    status: "EXPIRED",
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: null,
    summary: "15% off",
  },
};

test("normalizes the live free-shipping discount shape", async () => {
  installFetch(() => discountsPage([freeShipping]));
  const { discounts, count } = await getDiscounts({ activeOnly: true });

  assert.equal(count, 1);
  assert.deepEqual(discounts[0], {
    id: "gid://shopify/DiscountAutomaticNode/1296416964655",
    title: "Free Shipping Above Rs. 3,000",
    summary: "Free shipping on all products • Minimum purchase of Rs3,000.00 • For all countries",
    status: "ACTIVE",
    startsAt: "2026-07-28T08:32:06Z",
    endsAt: null,
    appliesAutomatically: true,
    codes: [],
    kind: "free_shipping",
    type: "DiscountAutomaticFreeShipping",
  });
});

test("code discounts expose their redeem code and are not automatic", async () => {
  installFetch(() => discountsPage([codeDiscount]));
  const { discounts } = await getDiscounts({ activeOnly: true });
  assert.deepEqual(discounts[0].codes, ["EID20"]);
  assert.equal(discounts[0].appliesAutomatically, false);
  assert.equal(discounts[0].kind, "amount_off");
});

test("expired windows and non-ACTIVE statuses are filtered out", async () => {
  installFetch(() => discountsPage([freeShipping, expired, disabled]));
  const { discounts } = await getDiscounts({ activeOnly: true });
  assert.deepEqual(discounts.map((d) => d.title), ["Free Shipping Above Rs. 3,000"]);

  clearDiscountCache();
  installFetch(() => discountsPage([freeShipping, expired, disabled]));
  const all = await getDiscounts({ activeOnly: false });
  assert.equal(all.count, 3);
});

test("a discount that has not started yet is not advertised", () => {
  assert.equal(
    isCurrentlyRunning({ status: "ACTIVE", startsAt: "2999-01-01T00:00:00Z", endsAt: null }),
    false
  );
  assert.equal(isCurrentlyRunning({ status: "ACTIVE", startsAt: null, endsAt: null }), true);
});

test("discount pagination is followed and bounded", async () => {
  let calls = 0;
  installFetch(() => {
    calls += 1;
    return discountsPage([{ ...freeShipping, id: `gid://shopify/DiscountAutomaticNode/${calls}` }], {
      hasNextPage: true,
      endCursor: `c${calls}`,
    });
  });
  const { count } = await getDiscounts({ activeOnly: true });
  assert.equal(calls, 3, "bounded by MAX_PAGES");
  assert.equal(count, 3);
});

test("results are cached briefly so repeated turns do not re-query Shopify", async () => {
  let calls = 0;
  installFetch(() => {
    calls += 1;
    return discountsPage([freeShipping]);
  });
  await getDiscounts({});
  const second = await getDiscounts({});
  assert.equal(calls, 1);
  assert.equal(second.cached, true);
});

test("unknown discount union members do not crash normalisation", async () => {
  installFetch(() => discountsPage([{ id: "gid://x/1", discount: { __typename: "SomeFutureDiscount" } }]));
  const { discounts } = await getDiscounts({ activeOnly: false });
  assert.equal(discounts.length, 1);
  assert.equal(discounts[0].title, null);
  assert.equal(discounts[0].summary, null);
});

test("Shopify failures surface as internal errors with a safe message", async () => {
  installFetch(() => ({ body: { errors: [{ message: "boom" }] } }));
  await assert.rejects(() => getDiscounts({}), ShopifyError);
});

test("get_discounts is registered as a safe tool", () => {
  assert.ok(toolsByName.get_discounts);
  assert.equal(toolsByName.get_discounts.schema.parse({}).activeOnly, true);
});
