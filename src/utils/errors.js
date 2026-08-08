/**
 * Internal error types. `publicMessage` is the ONLY thing that may ever reach
 * a customer (or the LLM). Everything else is for server logs.
 */
export class AppError extends Error {
  constructor(message, { status = 500, code = "internal_error", publicMessage, details } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage || "Something went wrong. Please try again.";
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, {
      status: 400,
      code: "validation_error",
      publicMessage: message,
      details,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, { status: 404, code: "not_found", publicMessage: message });
  }
}

export class ShopifyError extends AppError {
  constructor(message, { status = 502, code = "shopify_error", publicMessage, details } = {}) {
    super(message, {
      status,
      code,
      publicMessage: publicMessage || "The store catalog is temporarily unavailable.",
      details,
    });
  }
}

export class ShopifyThrottledError extends ShopifyError {
  constructor(message = "Shopify API throttled", details) {
    super(message, {
      status: 429,
      code: "shopify_throttled",
      publicMessage: "The store is busy right now. Please try again in a moment.",
      details,
    });
  }
}

export class ShopifyAuthError extends ShopifyError {
  constructor(message = "Shopify rejected the access token") {
    super(message, {
      status: 502,
      code: "shopify_auth_error",
      publicMessage: "The store catalog is temporarily unavailable.",
    });
  }
}
