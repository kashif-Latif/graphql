import { AsyncLocalStorage } from "node:async_hooks";
import { timer } from "./logger.js";

/**
 * Per-request diagnostics.
 *
 * Every layer (Shopify client, search, tools, agent) records what it did into
 * an async-local trace, so the end of each API request can report exactly how
 * the answer was produced: retries, tool calls, pages fetched, query cost.
 *
 * Nothing here is required for correctness — if no trace is active the record
 * functions are no-ops, which keeps unit tests and scripts unaffected.
 */

const storage = new AsyncLocalStorage();

/**
 * Async-local context is the primary lookup, but it is not sufficient on its
 * own: LangChain installs its own AsyncLocalStorage on the first `.invoke()`
 * of a process, and that first call loses our store. Traces are therefore also
 * registered by requestId, which tools resolve from their config. The registry
 * is emptied when the request ends.
 */
const byRequestId = new Map();

function newTrace(meta = {}) {
  return {
    requestId: meta.requestId ?? null,
    threadId: meta.threadId ?? null,
    startedAt: Date.now(),
    elapsed: timer(),

    shopify: {
      requests: 0,      // successful GraphQL operations
      attempts: 0,      // HTTP attempts, including retried ones
      retries: 0,
      throttled: 0,
      errors: 0,
      durationMs: 0,
      requestedQueryCost: 0,
      actualQueryCost: 0,
      throttleStatus: null,
      operations: [],   // { name, attempts, durationMs, actualQueryCost, outcome }
    },

    search: {
      searches: 0,
      pagesFetched: 0,
      deepVariantFetches: 0,
      candidateProducts: 0,
      finalProducts: 0,
      queriesTried: [],
    },

    tools: [],          // { name, durationMs, ok, resultCount }

    llm: {
      calls: 0,
      retries: 0,
      rateLimited: 0,
      durationMs: 0,
    },
  };
}

/**
 * Run `fn` with a fresh trace attached to the async context.
 * If `fn` returns a promise the trace is released when it settles; otherwise
 * the caller must call endTrace() (Express does this on response finish).
 */
export function withTrace(meta, fn) {
  const trace = newTrace(meta);
  if (trace.requestId) byRequestId.set(trace.requestId, trace);

  return storage.run(trace, () => {
    const result = fn(trace);
    if (result && typeof result.then === "function") {
      return result.finally(() => endTrace(trace.requestId));
    }
    return result;
  });
}

export function endTrace(requestId) {
  if (requestId) byRequestId.delete(requestId);
}

/** @param {string} [requestId] fallback lookup when async context was lost */
export function getTrace(requestId) {
  return storage.getStore() ?? (requestId ? byRequestId.get(requestId) ?? null : null);
}

export function setTraceMeta(meta) {
  const trace = getTrace();
  if (trace) Object.assign(trace, meta);
}

/* ---------------- recorders (all no-op without a trace) ---------------- */

export function recordShopifyAttempt(requestId) {
  const trace = getTrace(requestId);
  if (!trace) return;
  trace.shopify.attempts += 1;
  if (trace.shopify.attempts > trace.shopify.requests + 1) trace.shopify.retries += 1;
}

export function recordShopifyRetry(reason, requestId) {
  const trace = getTrace(requestId);
  if (!trace) return;
  if (reason === "throttled") trace.shopify.throttled += 1;
}

export function recordShopifyResult({ operationName, attempts, durationMs, cost, outcome, requestId }) {
  const trace = getTrace(requestId);
  if (!trace) return;
  const s = trace.shopify;
  if (outcome === "ok") s.requests += 1;
  else s.errors += 1;
  s.durationMs += durationMs || 0;
  if (cost) {
    s.requestedQueryCost += cost.requestedQueryCost || 0;
    s.actualQueryCost += cost.actualQueryCost || 0;
    if (cost.throttleStatus) s.throttleStatus = cost.throttleStatus;
  }
  s.operations.push({
    name: operationName,
    attempts,
    durationMs: durationMs || 0,
    actualQueryCost: cost?.actualQueryCost ?? null,
    outcome,
  });
}

export function recordSearch({
  queryUsed,
  pagesFetched,
  deepVariantFetches,
  candidateProducts,
  finalProducts,
  requestId,
}) {
  const trace = getTrace(requestId);
  if (!trace) return;
  const s = trace.search;
  s.searches += 1;
  s.pagesFetched += pagesFetched || 0;
  s.deepVariantFetches += deepVariantFetches || 0;
  s.candidateProducts += candidateProducts || 0;
  s.finalProducts += finalProducts || 0;
  if (queryUsed) s.queriesTried.push(queryUsed);
}

export function recordTool({ name, durationMs, ok, resultCount, requestId }) {
  const trace = getTrace(requestId);
  if (!trace) return;
  trace.tools.push({ name, durationMs, ok, resultCount: resultCount ?? null });
}

export function recordLlm({ durationMs, retried, rateLimited, requestId }) {
  const trace = getTrace(requestId);
  if (!trace) return;
  trace.llm.calls += 1;
  trace.llm.durationMs += durationMs || 0;
  if (retried) trace.llm.retries += 1;
  if (rateLimited) trace.llm.rateLimited += 1;
}

/**
 * Flat, log/response-friendly summary of everything that happened.
 * @param {object} [trace]
 */
export function summarizeTrace(requestId) {
  const trace = getTrace(requestId);
  if (!trace) return null;
  return {
    requestId: trace.requestId,
    threadId: trace.threadId,
    totalDurationMs: trace.elapsed(),

    toolCalls: trace.tools.length,
    toolsUsed: trace.tools.map((tool) => tool.name),
    toolDetail: trace.tools,

    shopifyRequests: trace.shopify.requests,
    shopifyAttempts: trace.shopify.attempts,
    shopifyRetries: trace.shopify.retries,
    shopifyThrottled: trace.shopify.throttled,
    shopifyErrors: trace.shopify.errors,
    shopifyDurationMs: trace.shopify.durationMs,
    shopifyQueryCost: {
      requested: trace.shopify.requestedQueryCost,
      actual: trace.shopify.actualQueryCost,
      throttleStatus: trace.shopify.throttleStatus,
    },
    shopifyOperations: trace.shopify.operations,

    searches: trace.search.searches,
    pagesFetched: trace.search.pagesFetched,
    deepVariantFetches: trace.search.deepVariantFetches,
    candidateProducts: trace.search.candidateProducts,
    finalProducts: trace.search.finalProducts,
    shopifyQueriesTried: trace.search.queriesTried,

    llmCalls: trace.llm.calls,
    llmRetries: trace.llm.retries,
    llmRateLimited: trace.llm.rateLimited,
    llmDurationMs: trace.llm.durationMs,
  };
}
