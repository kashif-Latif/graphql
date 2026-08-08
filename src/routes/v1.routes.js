import { Router } from "express";
import * as z from "zod";
import { env } from "../config/env.js";
import { chatRateLimit, apiRateLimit } from "../middleware/rateLimit.js";
import { handleChatMessage } from "../services/chat.service.js";
import { searchProducts } from "../services/product.service.js";
import { getDiscounts } from "../services/discount.service.js";
import { renderChatFragment, renderChatPage } from "../utils/html.js";

/**
 * Public integration API (v1).
 *
 * Same agent, three renderings of one answer:
 *   POST|GET /api/v1/chat        -> application/json  (the normal API)
 *   POST|GET /api/v1/chat/raw    -> text/plain        (just the message)
 *   POST|GET /api/v1/chat/html   -> text/html         (message + product cards)
 *
 * GET is supported so the endpoints can be tried from a browser or a webhook
 * that cannot POST; the body and the query string accept the same fields.
 */
export const v1Router = Router();

const chatInputSchema = z.object({
  threadId: z.string().min(1).max(128),
  message: z.string().trim().min(1).max(env.limits.maxMessageLength),
});

function readChatInput(req) {
  const source = req.method === "GET" ? req.query : { ...req.query, ...(req.body ?? {}) };
  return chatInputSchema.parse({
    // A caller integrating a stateless webhook can omit threadId; each such
    // request is then its own conversation.
    threadId: source.threadId || source.sessionId || `anon-${req.requestId}`,
    message: source.message ?? source.q ?? source.text,
  });
}

async function runChat(req) {
  const { threadId, message } = readChatInput(req);
  return handleChatMessage({ threadId, message, requestId: req.requestId });
}

/* ------------------------------ JSON ------------------------------ */

function jsonHandler(req, res, next) {
  runChat(req)
    .then((result) => {
      res.json({
        success: true,
        threadId: result.threadId,
        message: result.message,
        products: result.products,
      });
    })
    .catch(next);
}

v1Router.post("/chat", chatRateLimit, jsonHandler);
v1Router.get("/chat", chatRateLimit, jsonHandler);

/* ------------------------------ RAW ------------------------------- */

function rawHandler(req, res, next) {
  runChat(req)
    .then((result) => {
      res.type("text/plain; charset=utf-8");
      res.setHeader("x-thread-id", result.threadId);
      res.setHeader("x-product-count", String(result.products.length));
      res.send(result.message);
    })
    .catch(next);
}

v1Router.post("/chat/raw", chatRateLimit, rawHandler);
v1Router.get("/chat/raw", chatRateLimit, rawHandler);

/* ------------------------------ HTML ------------------------------ */

function htmlHandler(req, res, next) {
  runChat(req)
    .then((result) => {
      // ?full=1 returns a standalone document (iframe / direct browser view);
      // the default is a fragment to embed in an existing page.
      const asPage = req.query.full === "1" || req.query.full === "true";
      const render = asPage ? renderChatPage : renderChatFragment;
      res.type("text/html; charset=utf-8");
      res.setHeader("x-thread-id", result.threadId);
      res.send(render(result, { storeDomain: env.shopify.storeDomain }));
    })
    .catch(next);
}

v1Router.post("/chat/html", chatRateLimit, htmlHandler);
v1Router.get("/chat/html", chatRateLimit, htmlHandler);

/* --------------------- non-AI catalogue endpoints --------------------- */

const numeric = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}, z.number());

const boolish = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  if (value === "true" || value === true || value === "1") return true;
  if (value === "false" || value === false || value === "0") return false;
  return value;
}, z.boolean());

const searchQuerySchema = z.object({
  query: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  productType: z.string().max(100).optional(),
  vendor: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  size: z.string().max(50).optional(),
  age: numeric.optional(),
  minPrice: numeric.optional(),
  maxPrice: numeric.optional(),
  inStock: boolish.optional(),
  limit: numeric.optional(),
});

v1Router.get("/products/search", apiRateLimit, async (req, res, next) => {
  try {
    const filters = searchQuerySchema.parse(req.query);
    const result = await searchProducts(filters, { requestId: req.requestId });
    res.json({ success: true, count: result.count, products: result.products });
  } catch (error) {
    next(error);
  }
});

v1Router.get("/discounts", apiRateLimit, async (req, res, next) => {
  try {
    const result = await getDiscounts(
      { activeOnly: req.query.activeOnly !== "false" },
      { requestId: req.requestId }
    );
    res.json({ success: true, count: result.count, discounts: result.discounts });
  } catch (error) {
    next(error);
  }
});
