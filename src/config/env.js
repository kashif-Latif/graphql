import "dotenv/config";

function str(name, fallback = undefined) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

export const env = {
  port: int("PORT", 3000),
  nodeEnv: str("NODE_ENV", "development"),
  isProduction: str("NODE_ENV", "development") === "production",

  shopify: {
    storeDomain: str("SHOPIFY_STORE_DOMAIN"),
    accessToken: str("SHOPIFY_ADMIN_ACCESS_TOKEN"),
    apiVersion: str("SHOPIFY_API_VERSION", "2025-01"),
    timeoutMs: int("SHOPIFY_TIMEOUT_MS", 15000),
  },

  ai: {
    model: str("AI_MODEL", "anthropic:claude-sonnet-5"),
    // Used only when the primary model is rate-limited. Should be a cheaper /
    // higher-quota model from the same provider.
    fallbackModel: str("AI_FALLBACK_MODEL"),
    apiKey: str("AI_API_KEY"),
    timeoutMs: int("AGENT_TIMEOUT_MS", 45000),
  },

  search: {
    maxResults: int("MAX_PRODUCT_RESULTS", 5),
    pageSize: int("SHOPIFY_PAGE_SIZE", 20),
    maxPages: int("MAX_PAGES_PER_SEARCH", 5),
    variantPageSize: int("VARIANT_PAGE_SIZE", 50),
    // Keeps the LLM payload small — matters a lot on token-per-minute plans.
    maxVariantsPerProduct: int("MAX_VARIANTS_PER_PRODUCT", 6),
  },

  limits: {
    maxMessageLength: int("MAX_MESSAGE_LENGTH", 1000),
  },

  enableToolTester: bool("ENABLE_TOOL_TESTER", str("NODE_ENV", "development") !== "production"),
};

/**
 * LangChain model providers read their credentials from provider-specific env
 * vars. We map the single AI_API_KEY onto the configured provider so callers
 * only have to set one variable.
 */
export function applyModelCredentials() {
  if (!env.ai.apiKey) return;
  const provider = env.ai.model.includes(":") ? env.ai.model.split(":")[0] : "anthropic";
  const target = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    "google-genai": "GOOGLE_API_KEY",
    google: "GOOGLE_API_KEY",
    groq: "GROQ_API_KEY",
    mistralai: "MISTRAL_API_KEY",
  }[provider];
  if (target && !process.env[target]) process.env[target] = env.ai.apiKey;
}

export function assertShopifyConfig() {
  const missing = [];
  if (!env.shopify.storeDomain) missing.push("SHOPIFY_STORE_DOMAIN");
  if (!env.shopify.accessToken) missing.push("SHOPIFY_ADMIN_ACCESS_TOKEN");
  if (missing.length) {
    throw new Error(`Missing required Shopify configuration: ${missing.join(", ")}`);
  }
}

applyModelCredentials();
