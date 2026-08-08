import { ZodError } from "zod";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: { code: "not_found", message: "Endpoint not found" } });
}

/* eslint-disable no-unused-vars */
export function errorHandler(error, req, res, next) {
  if (error instanceof ZodError) {
    logger.warn("request.validation_error", {
      requestId: req.requestId,
      path: req.path,
      issues: error.issues,
    });
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

  return res.status(500).json({
    success: false,
    error: { code: "internal_error", message: "Something went wrong. Please try again." },
  });
}
