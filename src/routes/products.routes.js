import { Router } from "express";
import {
  searchProductsController,
  getProductController,
  getProductVariantsController,
  checkInventoryController,
} from "../controllers/products.controller.js";

export const productsRouter = Router();

// Non-AI search — same searchProducts() service the agent tool uses.
productsRouter.get("/search", searchProductsController);
productsRouter.get("/:productId(*)/variants", getProductVariantsController);
productsRouter.get("/:productId(*)/inventory", checkInventoryController);
productsRouter.get("/:productId(*)", getProductController);
