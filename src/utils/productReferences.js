import { normalizeText } from "./normalize.js";

/**
 * Resolves conversational references ("the second one", "that product") to
 * concrete Shopify product ids using the structured state saved from the
 * previous assistant turn. This is what stops the agent from running a fresh
 * broad search for every follow-up question.
 */

const ORDINALS = new Map([
  ["first", 1], ["1st", 1], ["one", 1],
  ["second", 2], ["2nd", 2], ["two", 2],
  ["third", 3], ["3rd", 3], ["three", 3],
  ["fourth", 4], ["4th", 4], ["four", 4],
  ["fifth", 5], ["5th", 5], ["five", 5],
  ["last", -1],
]);

const ORDINAL_RE = new RegExp(
  `\\b(${[...ORDINALS.keys()].join("|")})\\b\\s*(?:one|product|item|option)?\\b`,
  "i"
);

const NUMBERED_RE = /\b(?:number|no\.?|#)\s*(\d{1,2})\b/i;
const DEMONSTRATIVE_RE = /\b(that|this|it|those|these|the same)\b/i;

/**
 * Build the compact reference block injected into the agent context.
 * @param {import("../services/memory.service.js").ThreadState} state
 */
export function buildReferenceContext(state) {
  if (!state.lastShownProducts?.length && !state.lastSelectedProductId) return "";

  const lines = (state.lastShownProducts || []).map(
    (ref) => `${ref.position}. ${ref.title} — ${ref.productId}`
  );

  return [
    "PRODUCTS MOST RECENTLY SHOWN TO THIS CUSTOMER (use these ids for follow-up questions):",
    ...lines,
    state.lastSelectedProductId
      ? `Currently discussed product: ${state.lastSelectedProductId}`
      : null,
    "When the customer says \"the second one\", \"that one\", or similar, map it to the id above and call the appropriate tool with that id. Do not run a new broad search.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Best-effort deterministic resolution, used to pre-select the referenced
 * product before the model even runs.
 * @returns {string|null} product GID
 */
export function resolveProductReference(message, state) {
  const shown = state?.lastShownProducts || [];
  const text = normalizeText(message);
  if (!text) return null;

  const numbered = text.match(NUMBERED_RE);
  if (numbered) return byPosition(shown, Number.parseInt(numbered[1], 10));

  const ordinal = text.match(ORDINAL_RE);
  if (ordinal) {
    const position = ORDINALS.get(ordinal[1].toLowerCase());
    if (position === -1) return shown.length ? shown[shown.length - 1].productId : null;
    if (position) return byPosition(shown, position);
  }

  // Title mention wins over a bare demonstrative.
  for (const ref of shown) {
    const title = normalizeText(ref.title);
    if (title && title.length > 6 && text.includes(title.split(" ").slice(0, 3).join(" "))) {
      return ref.productId;
    }
  }

  if (DEMONSTRATIVE_RE.test(text)) {
    return state?.lastSelectedProductId || (shown.length === 1 ? shown[0].productId : null);
  }

  return null;
}

function byPosition(shown, position) {
  const ref = shown.find((entry) => entry.position === position);
  return ref ? ref.productId : null;
}

/** Persist the products shown in this turn so the next turn can resolve them. */
export function rememberShownProducts(state, products) {
  if (!products?.length) return state;
  state.lastShownProducts = products.slice(0, 5).map((product, index) => ({
    position: index + 1,
    productId: product.id,
    title: product.title,
    url: product.url ?? null,
  }));
  if (products.length === 1) state.lastSelectedProductId = products[0].id;
  return state;
}
