/**
 * Text / colour / size / price normalisation helpers.
 *
 * Rule of thumb: normalise only what is a spelling or formatting difference.
 * Never collapse two colours (or sizes) that a customer would consider
 * different — "sky blue" must not become "blue".
 */

/** Unicode dashes Shopify merchants commonly paste into option values. */
const DASHES = /[‐‑‒–—―−]/g;

/** Lowercase, collapse whitespace, unify dashes. Keeps meaningful words. */
export function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFKD")
    .replace(DASHES, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Spelling variants only — never merges distinct colours. */
const COLOR_SPELLINGS = new Map([
  ["grey", "gray"],
  ["gray", "gray"],
  ["charcoal grey", "charcoal gray"],
  ["light grey", "light gray"],
  ["dark grey", "dark gray"],
  ["off white", "off-white"],
  ["offwhite", "off-white"],
  ["multi colour", "multicolor"],
  ["multi color", "multicolor"],
  ["multicolour", "multicolor"],
  ["colour", "color"],
]);

/**
 * normalizeColor("Grey")      -> "gray"
 * normalizeColor("BLACK")     -> "black"
 * normalizeColor("sky blue")  -> "sky blue"   (kept distinct from "blue")
 */
export function normalizeColor(value) {
  let text = normalizeText(value);
  if (!text) return "";
  text = text.replace(/\bcolour\b/g, "color").replace(/\bgrey\b/g, "gray");
  return COLOR_SPELLINGS.get(text) || text;
}

/**
 * Two colours match when their normalised forms are equal, or when one is a
 * whole-word prefix/suffix qualifier of the other ("black" vs "jet black").
 * "blue" does NOT match "sky blue" in the strict direction: a request for
 * "sky blue" only matches "sky blue", while a request for plain "blue"
 * accepts qualified blues.
 */
export function colorMatches(variantColor, requestedColor) {
  const want = normalizeColor(requestedColor);
  const have = normalizeColor(variantColor);
  if (!want) return true;
  if (!have) return false;
  if (have === want) return true;
  const wantWords = want.split(" ");
  const haveWords = have.split(" ");
  if (wantWords.length === 1) {
    return haveWords.includes(wantWords[0]);
  }
  return wantWords.every((word) => haveWords.includes(word));
}

/**
 * normalizeSize("1–2 Years")   -> "1-2 years"
 * normalizeSize("1 - 2 Years") -> "1-2 years"
 * normalizeSize(" XL ")        -> "xl"
 * The original display value is always preserved by the caller.
 */
export function normalizeSize(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return text
    .replace(/\s*-\s*/g, "-")
    .replace(/\s*\*\s*/g, "*")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\byrs?\b|\byear\b/g, "years")
    .replace(/\bmos?\b|\bmonth\b/g, "months")
    .trim();
}

/** Loose size comparison: exact, or requested size contained as a token run. */
export function sizeMatches(variantSize, requestedSize) {
  const want = normalizeSize(requestedSize);
  const have = normalizeSize(variantSize);
  if (!want) return true;
  if (!have) return false;
  if (have === want) return true;
  // "1-2 years (16)" should match a request for "1-2 years"
  return have.includes(want);
}

/**
 * Shopify money fields are decimal strings ("999.00"). Returns null for
 * missing/garbage values so callers can decide (never NaN).
 */
export function toPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/** Inventory can be null when a variant is not tracked. Treat null as unknown. */
export function toInventory(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}
