import { normalizeSize } from "./normalize.js";

/**
 * Age matching for kids/baby catalogues.
 *
 * Everything is converted to MONTHS internally.
 *
 * BOUNDARY BEHAVIOUR (deterministic, documented on purpose):
 *  - A parsed range is treated as INCLUSIVE at both ends.
 *      "1-2 Years"  -> 12..24 months
 *      "0-6 Months" ->  0..6  months
 *  - Therefore age = 2 years (24 months) matches BOTH "1-2 Years" and
 *    "2-3 Years". This is intentional: retail size ranges overlap at their
 *    edges and a shopper asking for "a 2 year old" is happy with either.
 *  - A single value with a unit ("2 Years", "6 Months") is an exact point:
 *    it matches only that many months.
 *  - "Newborn" / "NB" maps to 0..3 months.
 *  - A variant whose option values contain NO recognisable age token is
 *    treated as AGE-AGNOSTIC and matches any age (e.g. a towel sized
 *    "30*30 Inches"). Age never silently removes non-apparel products.
 */

const UNIT_MONTHS = { month: 1, months: 1, m: 1, year: 12, years: 12, y: 12 };

const RANGE_RE = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(months|month|years|year|m|y)\b/;
const SPLIT_UNIT_RANGE_RE =
  /(\d+(?:\.\d+)?)\s*(months|month|years|year|m|y)\s*-\s*(\d+(?:\.\d+)?)\s*(months|month|years|year|m|y)\b/;
const SINGLE_RE = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(months|month|years|year|m|y)\b/;
const NEWBORN_RE = /\b(newborn|new born|nb)\b/;

/** @returns {{minMonths:number,maxMonths:number}|null} */
export function parseAgeRange(value) {
  const text = normalizeSize(value);
  if (!text) return null;

  if (NEWBORN_RE.test(text)) return { minMonths: 0, maxMonths: 3 };

  const split = text.match(SPLIT_UNIT_RANGE_RE);
  if (split) {
    const min = Number.parseFloat(split[1]) * UNIT_MONTHS[split[2]];
    const max = Number.parseFloat(split[3]) * UNIT_MONTHS[split[4]];
    return normalizeRange(min, max);
  }

  const range = text.match(RANGE_RE);
  if (range) {
    const unit = UNIT_MONTHS[range[3]];
    return normalizeRange(Number.parseFloat(range[1]) * unit, Number.parseFloat(range[2]) * unit);
  }

  const single = text.match(SINGLE_RE);
  if (single) {
    const months = Number.parseFloat(single[1]) * UNIT_MONTHS[single[2]];
    return normalizeRange(months, months);
  }

  return null;
}

function normalizeRange(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { minMonths: Math.min(min, max), maxMonths: Math.max(min, max) };
}

/** Age expressed in YEARS (0.5 === 6 months) -> months. */
export function ageYearsToMonths(ageYears) {
  return Math.round(Number(ageYears) * 12);
}

/** Strings on a variant that could carry an age token. */
function ageCandidates(variant) {
  const values = [];
  for (const option of variant.selectedOptions || []) {
    values.push(option.value);
  }
  if (variant.title) {
    for (const part of String(variant.title).split("/")) values.push(part);
  }
  return values.filter(Boolean);
}

/**
 * @param {object} variant normalized variant (selectedOptions + title)
 * @param {number} ageYears requested age in years
 * @returns {boolean}
 */
export function variantMatchesAge(variant, ageYears) {
  if (ageYears === undefined || ageYears === null) return true;
  const months = ageYearsToMonths(ageYears);
  if (!Number.isFinite(months)) return true;

  const ranges = ageCandidates(variant)
    .map(parseAgeRange)
    .filter(Boolean);

  // No age information on this variant -> age-agnostic product.
  if (ranges.length === 0) return true;

  return ranges.some((r) => months >= r.minMonths && months <= r.maxMonths);
}
