import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { env } from "./config/env.js";
import { logger, timer } from "./utils/logger.js";
import { apiRateLimit } from "./middleware/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { withTrace, summarizeTrace, endTrace } from "./utils/trace.js";
import { productsRouter } from "./routes/products.routes.js";
import { discountsRouter } from "./routes/discounts.routes.js";
import { chatRouter } from "./routes/chat.routes.js";
import { toolsRouter } from "./routes/tools.routes.js";
import { shopifyGraphQL } from "./shopify/client.js";
import { SHOP_PROBE_QUERY } from "./shopify/queries.js";
import { agentConfigStatus } from "./agent/agent.js";

const SERVICE_NAME = "shopify-live-product-search-agent";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    helmet({
      // The bundled test console is a single self-contained page with inline
      // <script>/<style> and Shopify CDN thumbnails. It is only served when
      // the tool tester is enabled (i.e. not in production).
      contentSecurityPolicy: env.enableToolTester
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "https://cdn.shopify.com"],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : undefined,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(express.json({ limit: "32kb" }));

  // Dev only: let the test console call this API when it is being served from
  // somewhere else (VS Code Live Server, file://, another port). Never enabled
  // in production, where the browser and API share an origin.
  if (env.enableToolTester) {
    app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", req.get("origin") || "*");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "content-type, x-request-id");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") return res.sendStatus(204);
      next();
    });
  }

  // Static test console at GET / — dev only, same gate as the tool tester.
  if (env.enableToolTester) {
    const publicDir = path.resolve(fileURLToPath(new URL("../public", import.meta.url)));
    app.use(express.static(publicDir, { index: "index.html" }));
  }

  /**
   * Request id + full diagnostics trace. Everything the request did — tool
   * calls, Shopify operations, retries, throttling, query cost, LLM calls —
   * is collected in an async-local trace and reported when the request ends.
   */
  app.use((req, res, next) => {
    req.requestId = req.get("x-request-id") || randomUUID();
    res.setHeader("x-request-id", req.requestId);

    withTrace({ requestId: req.requestId }, () => {
      const elapsed = timer();

      // In dev, the same summary is attached to the JSON body so it is
      // visible in the browser console without reading server logs.
      if (env.enableToolTester) {
        const originalJson = res.json.bind(res);
        res.json = (body) => {
          const diagnostics = summarizeTrace(req.requestId);
          if (body && typeof body === "object" && !Array.isArray(body) && diagnostics) {
            body.diagnostics = diagnostics;
          }
          return originalJson(body);
        };
      }

      res.on("finish", () => {
        const summary = summarizeTrace(req.requestId) || {};
        logger.info("http.request", {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: elapsed(),
          ...summary,
        });
        endTrace(req.requestId);
      });

      next();
    });
  });

  // Cheap: no Shopify call. `service` lets the test console confirm it is
  // talking to THIS backend and not another app on the same port.
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: SERVICE_NAME, aiConfigured: agentConfigStatus().configured });
  });

  // Separate, deliberately more expensive connectivity check.
  app.get("/api/health/shopify", async (req, res) => {
    try {
      const { data, durationMs } = await shopifyGraphQL(
        SHOP_PROBE_QUERY,
        {},
        { operationName: "ShopProbe", requestId: req.requestId }
      );
      res.json({
        status: "ok",
        shop: data.shop?.name ?? null,
        domain: data.shop?.myshopifyDomain ?? null,
        apiVersion: env.shopify.apiVersion,
        durationMs,
      });
    } catch (error) {
      logger.error("health.shopify_failed", { requestId: req.requestId, message: error?.message });
      res.status(503).json({ status: "unavailable" });
    }
  });

  app.use("/api/products", apiRateLimit, productsRouter);
  app.use("/api/discounts", apiRateLimit, discountsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/tools", toolsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
