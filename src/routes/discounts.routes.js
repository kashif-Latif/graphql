import { Router } from "express";
import { getDiscounts } from "../services/discount.service.js";

export const discountsRouter = Router();

// Non-AI: same getDiscounts() service the get_discounts tool calls.
discountsRouter.get("/", async (req, res, next) => {
  try {
    const activeOnly = req.query.activeOnly !== "false";
    const result = await getDiscounts({ activeOnly }, { requestId: req.requestId });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});
