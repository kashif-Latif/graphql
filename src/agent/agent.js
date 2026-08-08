import { createAgent } from "langchain";
import { productTools } from "../tools/index.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

/** One agent per model id (primary + optional rate-limit fallback). */
const agents = new Map();

/** Provider env var that must be present for the configured AI_MODEL. */
const PROVIDER_KEY_ENV = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  "google-genai": "GOOGLE_API_KEY",
  google: "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  mistralai: "MISTRAL_API_KEY",
};

/** @returns {{configured: boolean, provider: string, envVar: string|null}} */
export function agentConfigStatus() {
  const provider = env.ai.model.includes(":") ? env.ai.model.split(":")[0] : "anthropic";
  const envVar = PROVIDER_KEY_ENV[provider] || null;
  const configured = Boolean(env.ai.apiKey || (envVar && process.env[envVar]));
  return { configured, provider, envVar };
}

/**
 * The agent layer knows about tools and prompts only — never about Shopify
 * GraphQL. Created lazily so the REST catalogue endpoints work without any
 * LLM credentials configured.
 */
export function getAgent(model = env.ai.model) {
  const status = agentConfigStatus();
  if (!status.configured) {
    // A configuration mistake, not a customer-facing failure — say so plainly
    // so it is obvious in the dev console. No secret is revealed.
    throw new AppError(`AI_API_KEY is not set for provider "${status.provider}"`, {
      status: 503,
      code: "agent_not_configured",
      publicMessage: `The AI assistant isn't configured yet: set AI_API_KEY in .env (provider "${status.provider}") and restart the server. The non-AI product search endpoints work without it.`,
    });
  }
  if (!agents.has(model)) {
    agents.set(
      model,
      createAgent({
        model,
        tools: productTools,
        systemPrompt: SYSTEM_PROMPT,
      })
    );
  }
  return agents.get(model);
}

export function resetAgent() {
  agents.clear();
}
