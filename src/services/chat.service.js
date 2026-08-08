import { getAgent } from "../agent/agent.js";
import { env } from "../config/env.js";
import { logger, timer } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";
import { recordLlm, setTraceMeta, summarizeTrace } from "../utils/trace.js";
import {
  loadThread,
  saveThread,
  appendMessage,
  recentMessages,
  updateSummary,
} from "./memory.service.js";
import {
  buildReferenceContext,
  resolveProductReference,
  rememberShownProducts,
} from "../utils/productReferences.js";

/** Past assistant turns are replayed truncated to this many characters. */
const HISTORY_CHAR_LIMIT = 400;

/**
 * Build the smallest useful context: rolling summary + last N messages +
 * structured product references + the new user message. The full lifetime
 * transcript is never sent.
 */
function buildMessages(state, userMessage, resolvedProductId) {
  const messages = [];

  const contextParts = [];
  if (state.summary) {
    contextParts.push(`EARLIER IN THIS CONVERSATION:\n${state.summary}`);
  }
  const references = buildReferenceContext(state);
  if (references) contextParts.push(references);
  if (resolvedProductId) {
    contextParts.push(
      `The customer's message appears to refer to product ${resolvedProductId}. Use that id directly.`
    );
  }
  if (contextParts.length) {
    messages.push({ role: "system", content: contextParts.join("\n\n") });
  }

  // Replayed history is truncated: the structured product references above
  // carry what matters for follow-ups, so full past answers are dead weight.
  for (const message of recentMessages(state)) {
    messages.push({
      role: message.role,
      content:
        message.role === "assistant" && message.content.length > HISTORY_CHAR_LIMIT
          ? `${message.content.slice(0, HISTORY_CHAR_LIMIT)}…`
          : message.content,
    });
  }

  messages.push({ role: "user", content: userMessage });
  return messages;
}

/** Pull structured product data out of the tool results of this turn. */
export function extractProducts(agentMessages) {
  const products = [];
  const seen = new Set();

  for (const message of agentMessages || []) {
    const type = message?.getType?.() ?? message?.role ?? message?._getType?.();
    if (type !== "tool") continue;

    let payload;
    try {
      payload = typeof message.content === "string" ? JSON.parse(message.content) : message.content;
    } catch {
      continue;
    }
    if (!payload || payload.error) continue;

    const candidates = [];
    if (Array.isArray(payload.products)) candidates.push(...payload.products);
    if (payload.product) candidates.push(payload.product);
    if (payload.productId && payload.title) {
      candidates.push({
        id: payload.productId,
        title: payload.title,
        handle: payload.handle,
        url: payload.url,
        variants: payload.variants,
      });
    }

    for (const candidate of candidates) {
      if (!candidate?.id || seen.has(candidate.id) || candidate.error) continue;
      seen.add(candidate.id);
      const variants = candidate.matchingVariants || candidate.variants || [];
      products.push({
        id: candidate.id,
        title: candidate.title ?? null,
        handle: candidate.handle ?? null,
        url: candidate.url ?? (candidate.handle ? `/products/${candidate.handle}` : null),
        image: candidate.image ?? null,
        variants: variants.slice(0, 10).map((variant) => ({
          id: variant.id,
          title: variant.title,
          price: variant.price ?? null,
          available: Boolean(variant.available),
        })),
      });
    }
  }

  return products;
}

function lastAssistantText(agentMessages) {
  for (let i = (agentMessages || []).length - 1; i >= 0; i -= 1) {
    const message = agentMessages[i];
    const type = message?.getType?.() ?? message?.role ?? message?._getType?.();
    if (type !== "ai" && type !== "assistant") continue;
    const content = message.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const text = content
        .filter((part) => part?.type === "text" && part.text)
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) return text;
    }
  }
  return "";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimit(error) {
  const status = error?.status ?? error?.response?.status;
  return status === 429 || /rate.?limit|429/i.test(error?.message || "");
}

/** Providers often state the wait in the error body ("try again in 7.44s"). */
function retryAfterMs(error) {
  const match = /try again in ([\d.]+)\s*s/i.exec(error?.message || "");
  const seconds = match ? Number.parseFloat(match[1]) : NaN;
  return Number.isFinite(seconds) ? Math.min(Math.ceil(seconds * 1000) + 500, 15000) : 3000;
}

/**
 * Invoke the agent, surviving a provider rate limit.
 *
 * Free tiers have tight tokens-per-minute budgets. A retry re-runs the whole
 * agent — including its tool calls — so retrying on the SAME model tends to
 * burn the budget again and fail twice. When AI_FALLBACK_MODEL is configured
 * we switch to it instead of waiting; only without one do we back off and
 * retry the primary model.
 */
async function invokeAgent(messages, { requestId, threadId }) {
  const models = [env.ai.model, env.ai.fallbackModel].filter(Boolean);
  let modelIndex = 0;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const model = models[modelIndex] ?? models[0];
    const agent = getAgent(model);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.ai.timeoutMs);
    const elapsed = timer();
    try {
      const result = await agent.invoke(
        { messages },
        { signal: controller.signal, configurable: { requestId, thread_id: threadId } }
      );
      recordLlm({ durationMs: elapsed(), retried: attempt > 1, requestId });
      return result;
    } catch (error) {
      recordLlm({ durationMs: elapsed(), retried: attempt > 1, rateLimited: isRateLimit(error), requestId });
      if (error instanceof AppError) throw error;

      if (isRateLimit(error)) {
        const hasFallback = modelIndex + 1 < models.length;
        const waitMs = hasFallback ? 0 : retryAfterMs(error);
        logger.warn("chat.rate_limited", {
          requestId,
          threadId,
          attempt,
          model,
          waitMs,
          fallbackModel: hasFallback ? models[modelIndex + 1] : null,
        });
        if (attempt === 1) {
          if (hasFallback) modelIndex += 1;
          else await sleep(waitMs);
          continue;
        }
        throw new AppError(`LLM rate limit: ${error?.message}`, {
          status: 429,
          code: "agent_rate_limited",
          publicMessage:
            "I'm handling a lot of requests right now — please wait a few seconds and ask again.",
        });
      }

      logger.error("chat.agent_failed", { requestId, threadId, message: error?.message });
      throw new AppError(`Agent invocation failed: ${error?.message}`, {
        status: 502,
        code: "agent_error",
        publicMessage: "I couldn't reach the assistant just now. Please try again.",
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new AppError("Agent invocation exhausted retries", {
    status: 502,
    code: "agent_error",
    publicMessage: "I couldn't reach the assistant just now. Please try again.",
  });
}

/**
 * Handle one customer turn.
 * @param {{threadId: string, message: string, requestId?: string}} input
 */
export async function handleChatMessage({ threadId, message, requestId }) {
  const elapsed = timer();
  setTraceMeta({ threadId });
  const state = await loadThread(threadId);
  const resolvedProductId = resolveProductReference(message, state);

  // Promotions are NOT injected into every turn — the trace showed the model
  // calls get_discounts anyway, so injecting them just burns tokens.
  const messages = buildMessages(state, message, resolvedProductId);

  const result = await invokeAgent(messages, { requestId, threadId });

  const agentMessages = result?.messages || [];
  const products = extractProducts(agentMessages);
  const reply =
    lastAssistantText(agentMessages) ||
    "Sorry, I couldn't put together an answer for that. Could you rephrase?";

  appendMessage(state, "user", message);
  appendMessage(state, "assistant", reply);
  if (products.length) rememberShownProducts(state, products);
  if (resolvedProductId) state.lastSelectedProductId = resolvedProductId;
  else if (products.length === 1) state.lastSelectedProductId = products[0].id;
  updateSummary(state);
  await saveThread(state);

  const durationMs = elapsed();
  logger.info("chat.completed", {
    requestId,
    threadId,
    resolvedProductId,
    productCount: products.length,
    agentDurationMs: durationMs,
    ...(summarizeTrace(requestId) || {}),
  });

  return { threadId, message: reply, products };
}
