import { Router } from "express";
import { chatController, resetChatController } from "../controllers/chat.controller.js";
import { chatRateLimit } from "../middleware/rateLimit.js";

export const chatRouter = Router();

chatRouter.post("/", chatRateLimit, chatController);
chatRouter.post("/reset", chatRateLimit, resetChatController);
