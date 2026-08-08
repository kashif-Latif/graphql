import test from "node:test";
import assert from "node:assert/strict";
import { parseAgeRange, variantMatchesAge, ageYearsToMonths } from "../src/utils/age.js";

test("parseAgeRange understands the store's size vocabulary", () => {
  assert.deepEqual(parseAgeRange("0-6 Months"), { minMonths: 0, maxMonths: 6 });
  assert.deepEqual(parseAgeRange("9–12 Months"), { minMonths: 9, maxMonths: 12 });
  assert.deepEqual(parseAgeRange("6-24 Months"), { minMonths: 6, maxMonths: 24 });
  assert.deepEqual(parseAgeRange("1-2 Years (16)"), { minMonths: 12, maxMonths: 24 });
  assert.deepEqual(parseAgeRange("0-3 Years"), { minMonths: 0, maxMonths: 36 });
  assert.deepEqual(parseAgeRange("2 Years"), { minMonths: 24, maxMonths: 24 });
  assert.deepEqual(parseAgeRange("Newborn"), { minMonths: 0, maxMonths: 3 });
  assert.equal(parseAgeRange("30*30 Inches"), null);
  assert.equal(parseAgeRange("XL"), null);
});

test("age boundaries are inclusive at both ends (documented behaviour)", () => {
  const v = (size) => ({ selectedOptions: [{ name: "Size", value: size }], title: size });
  assert.equal(variantMatchesAge(v("1-2 Years"), 2), true);
  assert.equal(variantMatchesAge(v("2-3 Years"), 2), true);
  assert.equal(variantMatchesAge(v("1-2 Years"), 3), false);
  assert.equal(variantMatchesAge(v("0-6 Months"), 0.5), true);
  assert.equal(variantMatchesAge(v("0-6 Months"), 1), false);
  assert.equal(variantMatchesAge(v("9-12 Months"), 1), true);
});

test("variants with no age token are age-agnostic", () => {
  const towel = { selectedOptions: [{ name: "Size", value: "30*30 Inches" }], title: "Pink / 30*30 Inches" };
  assert.equal(variantMatchesAge(towel, 0), true);
  assert.equal(variantMatchesAge(towel, 5), true);
});

test("age falls back to the variant title when options are unnamed", () => {
  const legacy = { selectedOptions: [], title: "Black / 1–2 Years (16)" };
  assert.equal(variantMatchesAge(legacy, 1.5), true);
  assert.equal(variantMatchesAge(legacy, 4), false);
});

test("ageYearsToMonths", () => {
  assert.equal(ageYearsToMonths(2), 24);
  assert.equal(ageYearsToMonths(0.5), 6);
  assert.equal(ageYearsToMonths(0), 0);
});
