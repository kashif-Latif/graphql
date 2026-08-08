import { ZodError } from "zod";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";
import { escapeHtml } from "../utils/html.js";

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: { code: "not_found", message: "Endpoint not found" } });
}

/**
 * /api/v1/chat/raw and /html must fail in their own content type — an
 * integration parsing text/plain should never suddenly receive JSON.
 */
function sendError(req, res, status, code, message) {
  if (req.path.endsWith("/raw")) {
    res.status(status).type("text/plain; charset=utf-8").send(message);
    return true;
  }
  if (req.path.endsWith("/html")) {
    res
      .status(status)
      .type("text/html; charset=utf-8")
      .send(`<div class="sai-response sai-error" data-error="${escapeHtml(code)}"><p>${escapeHtml(message)}</p></div>`);
    return true;
  }
  return false;
}

/* eslint-disable no-unused-vars */
export function errorHandler(error, req, res, next) {
  if (error instanceof ZodError) {
    logger.warn("request.validation_error", {
      requestId: req.requestId,
      path: req.path,
      issues: error.issues,
    });
    if (sendError(req, res, 400, "validation_error", "Invalid request")) return undefined;
    return res.status(400).json({
      success: false,
      error: {
        code: "validation_error",
        message: "Invalid request",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }

  if (error instanceof AppError) {
    logger[error.status >= 500 ? "error" : "warn"]("request.app_error", {
      requestId: req.requestId,
      path: req.path,
      code: error.code,
      message: error.message,
    });
    if (sendError(req, res, error.status, error.code, error.publicMessage)) return undefined;
    return res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.publicMessage },
    });
  }

  // Unknown error: log everything, leak nothing.
  logger.error("request.unhandled_error", {
    requestId: req.requestId,
    path: req.path,
    message: error?.message,
    stack: env.isProduction ? undefined : error?.stack,
  });

  const generic = "Something went wrong. Please try again.";
  if (sendError(req, res, 500, "internal_error", generic)) return undefined;
  return res.status(500).json({
    success: false,
    error: { code: "internal_error", message: generic },
  });
}
