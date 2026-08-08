import { env, assertShopifyConfig } from "../config/env.js";
import { logger, timer } from "../utils/logger.js";
import { ShopifyError, ShopifyThrottledError, ShopifyAuthError } from "../utils/errors.js";
import { recordShopifyAttempt, recordShopifyRetry, recordShopifyResult } from "../utils/trace.js";

const MAX_RETRIES = 3;

/** Last observed throttle status, used to slow down pagination voluntarily. */
let lastThrottleStatus = null;

export function getThrottleStatus() {
  return lastThrottleStatus;
}

function endpoint() {
  return `https://${env.shopify.storeDomain}/admin/api/${env.shopify.apiVersion}/graphql.json`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isThrottledGraphQLError(errors) {
  return (errors || []).some(
    (error) =>
      error?.extensions?.code === "THROTTLED" ||
      /throttl/i.test(error?.message || "")
  );
}

/**
 * The single trusted entry point to Shopify. Nothing else in the codebase
 * performs HTTP requests to Shopify, and no caller may pass a document that
 * was built from user input.
 *
 * @param {string} query static GraphQL document
 * @param {object} variables
 * @param {{operationName?: string, requestId?: string}} [meta]
 */
export async function shopifyGraphQL(query, variables = {}, meta = {}) {
  assertShopifyConfig();

  const operationName = meta.operationName || "shopifyGraphQL";
  let attempt = 0;
  let lastError;

  while (attempt < MAX_RETRIES) {
    attempt += 1;
    recordShopifyAttempt(meta.requestId);
    const elapsed = timer();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.shopify.timeoutMs);

    let response;
    let body;
    try {
      response = await fetch(endpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": env.shopify.accessToken,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      lastError = new ShopifyError(
        error.name === "AbortError"
          ? `Shopify request timed out after ${env.shopify.timeoutMs}ms`
          : `Shopify request failed: ${error.message}`,
        { code: "shopify_unavailable" }
      );
      logger.warn("shopify.request_failed", {
        operationName,
        requestId: meta.requestId,
        attempt,
        error: lastError.message,
      });
      if (attempt < MAX_RETRIES) {
        recordShopifyRetry("network", meta.requestId);
        await sleep(300 * 2 ** (attempt - 1));
        continue;
      }
      recordShopifyResult({ requestId: meta.requestId, operationName, attempts: attempt, durationMs: 0, outcome: "error" });
      throw lastError;
    }
    clearTimeout(timeout);

    const durationMs = elapsed();

    if (response.status === 401 || response.status === 403) {
      recordShopifyResult({ requestId: meta.requestId, operationName, attempts: attempt, durationMs, outcome: "auth_error" });
      throw new ShopifyAuthError(`Shopify returned ${response.status} for ${operationName}`);
    }

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number.parseFloat(response.headers.get("retry-after") || "0");
      lastError =
        response.status === 429
          ? new ShopifyThrottledError(`Shopify throttled ${operationName}`)
          : new ShopifyError(`Shopify returned HTTP ${response.status} for ${operationName}`, {
              code: "shopify_unavailable",
            });
      logger.warn("shopify.http_error", {
        operationName,
        requestId: meta.requestId,
        status: response.status,
        attempt,
        durationMs,
      });
      if (attempt < MAX_RETRIES) {
        recordShopifyRetry(response.status === 429 ? "throttled" : "http_error", meta.requestId);
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1));
        continue;
      }
      recordShopifyResult({ requestId: meta.requestId, operationName, attempts: attempt, durationMs, outcome: "error" });
      throw lastError;
    }

    try {
      body = await response.json();
    } catch {
      throw new ShopifyError(`Shopify returned a malformed (non-JSON) response for ${operationName}`, {
        code: "shopify_malformed_response",
      });
    }

    if (!body || typeof body !== "object") {
      throw new ShopifyError(`Shopify returned an unexpected payload for ${operationName}`, {
        code: "shopify_malformed_response",
      });
    }

    const cost = body.extensions?.cost;
    if (cost) {
      lastThrottleStatus = cost.throttleStatus || lastThrottleStatus;
      logger.info("shopify.cost", {
        operationName,
        requestId: meta.requestId,
        durationMs,
        requestedQueryCost: cost.requestedQueryCost,
        actualQueryCost: cost.actualQueryCost,
        throttleStatus: cost.throttleStatus,
      });
    } else {
      logger.debug("shopify.ok", { operationName, requestId: meta.requestId, durationMs });
    }

    if (Array.isArray(body.errors) && body.errors.length > 0) {
      if (isThrottledGraphQLError(body.errors)) {
        lastError = new ShopifyThrottledError(`Shopify throttled ${operationName}`, {
          throttleStatus: cost?.throttleStatus,
        });
        logger.warn("shopify.throttled", {
          operationName,
          requestId: meta.requestId,
          attempt,
          throttleStatus: cost?.throttleStatus,
        });
        if (attempt < MAX_RETRIES) {
          recordShopifyRetry("throttled", meta.requestId);
          await sleep(1000 * attempt);
          continue;
        }
        recordShopifyResult({ requestId: meta.requestId, operationName, attempts: attempt, durationMs, cost, outcome: "throttled" });
        throw lastError;
      }
      const messages = body.errors.map((e) => e?.message).filter(Boolean).join("; ");
      recordShopifyResult({ requestId: meta.requestId, operationName, attempts: attempt, durationMs, cost, outcome: "graphql_error" });
      throw new ShopifyError(`Shopify GraphQL error on ${operationName}: ${messages}`, {
        code: "shopify_graphql_error",
        details: body.errors,
      });
    }

    if (!body.data) {
      recordShopifyResult({ requestId: meta.requestId, operationName, attempts: attempt, durationMs, cost, outcome: "error" });
      throw new ShopifyError(`Shopify returned no data for ${operationName}`, {
        code: "shopify_malformed_response",
      });
    }

    recordShopifyResult({ requestId: meta.requestId, operationName, attempts: attempt, durationMs, cost, outcome: "ok" });
    return { data: body.data, cost, durationMs };
  }

  throw lastError || new ShopifyError(`Shopify request failed for ${operationName}`);
}

/**
 * Voluntary back-pressure: when the leaky bucket is nearly empty, pause
 * briefly rather than firing another pagination request immediately.
 */
export async function respectThrottle() {
  const status = lastThrottleStatus;
  if (!status) return;
  const { currentlyAvailable, restoreRate = 50 } = status;
  if (typeof currentlyAvailable !== "number") return;
  if (currentlyAvailable > 200) return;
  const waitMs = Math.min(2000, Math.ceil(((250 - currentlyAvailable) / restoreRate) * 1000));
  if (waitMs > 0) {
    logger.debug("shopify.backpressure", { currentlyAvailable, waitMs });
    await sleep(waitMs);
  }
}
