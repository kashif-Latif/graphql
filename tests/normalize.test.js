import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeColor,
  colorMatches,
  normalizeSize,
  sizeMatches,
  toPrice,
  toInventory,
} from "../src/utils/normalize.js";

test("normalizeColor unifies spellings without merging distinct colors", () => {
  assert.equal(normalizeColor("Grey"), "gray");
  assert.equal(normalizeColor("grey"), "gray");
  assert.equal(normalizeColor("BLACK"), "black");
  assert.equal(normalizeColor("Pink"), "pink");
  assert.equal(normalizeColor("sky blue"), "sky blue");
  assert.notEqual(normalizeColor("sky blue"), normalizeColor("blue"));
});

test("colorMatches: qualified colors match a plain request, not the reverse", () => {
  assert.equal(colorMatches("Light Pink", "pink"), true);
  assert.equal(colorMatches("Sky Blue", "blue"), true);
  assert.equal(colorMatches("Blue", "sky blue"), false);
  assert.equal(colorMatches("Black", "pink"), false);
  assert.equal(colorMatches("Grey", "gray"), true);
  assert.equal(colorMatches(null, "pink"), false);
});

test("normalizeSize collapses dash and unit formatting, matching stays loose", () => {
  assert.equal(normalizeSize("1–2 Years"), normalizeSize("1-2 Years"));
  assert.equal(normalizeSize("1 – 2 Years"), normalizeSize("1-2 years"));
  assert.equal(sizeMatches("1–2 Years (16)", "1-2 years"), true);
  assert.equal(sizeMatches("2–3 Years (18)", "1-2 years"), false);
});

test("toPrice parses Shopify money strings and rejects garbage", () => {
  assert.equal(toPrice("999.00"), 999);
  assert.equal(toPrice("0.50"), 0.5);
  assert.equal(toPrice(""), null);
  assert.equal(toPrice(null), null);
  assert.equal(toPrice("not-a-price"), null);
  assert.equal(toPrice("-5.00"), null);
});

test("toInventory keeps null for untracked inventory", () => {
  assert.equal(toInventory(3), 3);
  assert.equal(toInventory(0), 0);
  assert.equal(toInventory(null), null);
  assert.equal(toInventory("oops"), null);
});
