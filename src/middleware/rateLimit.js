import rateLimit from "express-rate-limit";

const json = (code, message) => (req, res) =>
  res.status(429).json({ success: false, error: { code, message } });

/** Chat is LLM-backed and therefore the most expensive surface. */
export const chatRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: json("rate_limited", "You're sending messages too quickly. Please wait a moment."),
});

/** Plain catalogue reads. */
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: json("rate_limited", "Too many requests. Please slow down."),
});

/** Dev-only tool tester. */
export const toolRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: json("rate_limited", "Too many requests. Please slow down."),
});
