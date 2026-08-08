import * as z from "zod";
import { env } from "../config/env.js";
import { handleChatMessage } from "../services/chat.service.js";
import { clearThread } from "../services/memory.service.js";

const chatRequestSchema = z.object({
  threadId: z.string().min(1).max(128),
  message: z.string().trim().min(1).max(env.limits.maxMessageLength),
});

export async function chatController(req, res, next) {
  try {
    const { threadId, message } = chatRequestSchema.parse(req.body ?? {});
    const result = await handleChatMessage({ threadId, message, requestId: req.requestId });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function resetChatController(req, res, next) {
  try {
    const { threadId } = z.object({ threadId: z.string().min(1).max(128) }).parse(req.body ?? {});
    await clearThread(threadId);
    res.json({ success: true, threadId, cleared: true });
  } catch (error) {
    next(error);
  }
}
