import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, renderChatFragment, renderChatPage } from "../src/utils/html.js";

const payload = {
  message: "Here is a pink baby towel.\n\n1. Soft Baby Towel – Rs 399",
  products: [
    {
      id: "gid://shopify/Product/1",
      title: "Soft Baby Towel",
      handle: "soft-baby-towel",
      url: "/products/soft-baby-towel",
      image: "https://cdn.shopify.com/x.png",
      variants: [
        { id: "gid://shopify/ProductVariant/1", title: "Pink / 30*30 Inches", price: 399, available: true },
        { id: "gid://shopify/ProductVariant/2", title: "Blue / 30*30 Inches", price: 399, available: false },
      ],
    },
  ],
};

test("renders the message and product cards", () => {
  const html = renderChatFragment(payload);
  assert.match(html, /class="sai-response"/);
  assert.match(html, /<p>Here is a pink baby towel\.<\/p>/);
  assert.match(html, /data-product-id="gid:\/\/shopify\/Product\/1"/);
  assert.match(html, /Rs 399/);
  assert.match(html, /sai-variant-stock is-in">In stock/);
  assert.match(html, /sai-variant-stock is-out">Out of stock/);
});

test("product links are absolute when a store domain is supplied", () => {
  assert.match(
    renderChatFragment(payload, { storeDomain: "shop.myshopify.com" }),
    /href="https:\/\/shop\.myshopify\.com\/products\/soft-baby-towel"/
  );
  assert.match(renderChatFragment(payload), /href="\/products\/soft-baby-towel"/);
});

test("model text cannot inject markup", () => {
  const html = renderChatFragment({
    message: '<img src=x onerror="alert(1)"> & "quoted"',
    products: [],
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("hostile product data from Shopify is escaped too", () => {
  const html = renderChatFragment({
    message: "ok",
    products: [
      {
        id: 'gid://x"><script>alert(1)</script>',
        title: "<script>alert(1)</script>",
        url: "/products/x",
        image: "https://cdn.shopify.com/x.png",
        variants: [{ id: "v1", title: "<b>Pink</b>", price: 1, available: true }],
      },
    ],
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;Pink&lt;\/b&gt;/);
});

test("javascript: and data: URLs never reach an attribute", () => {
  const html = renderChatFragment({
    message: "ok",
    products: [
      {
        id: "p1",
        title: "Bad",
        url: "javascript:alert(1)",
        image: "data:text/html;base64,PHNjcmlwdD4=",
        variants: [],
      },
    ],
  });
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /data:text\/html/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<a /);
});

test("an answer with no products renders just the message", () => {
  const html = renderChatFragment({ message: "No matches, sorry.", products: [] });
  assert.match(html, /No matches, sorry\./);
  assert.doesNotMatch(html, /sai-products/);
});

test("the full page is a standalone document with styles", () => {
  const page = renderChatPage(payload);
  assert.match(page, /^<!doctype html>/);
  assert.match(page, /<style>/);
  assert.match(page, /sai-response/);
});

test("escapeHtml covers every dangerous character", () => {
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});
