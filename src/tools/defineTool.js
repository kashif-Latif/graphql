import { tool } from "langchain";
import { logger, timer } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";
import { recordTool } from "../utils/trace.js";

/**
 * Wraps a service call as a LangChain tool with uniform behaviour:
 *  - times the call and records it in the request trace
 *  - logs it
 *  - converts failures into a safe JSON payload the agent can read, never a
 *    stack trace or an internal message
 *
 * @param {{name: string, description: string, schema: import("zod").ZodTypeAny,
 *          run: (input: object, meta: object) => Promise<object>,
 *          count?: (result: object) => number|null}} spec
 */
export function defineTool(spec) {
  return tool(
    async (input, config) => {
      const requestId = config?.configurable?.requestId;
      const elapsed = timer();
      try {
        const result = await spec.run(input, { requestId });
        const durationMs = elapsed();
        const resultCount = spec.count ? spec.count(result) : null;
        recordTool({ name: spec.name, durationMs, ok: true, resultCount, requestId });
        logger.info(`tool.${spec.name}`, { requestId, durationMs, resultCount });
        return JSON.stringify(result);
      } catch (error) {
        const durationMs = elapsed();
        recordTool({ name: spec.name, durationMs, ok: false, resultCount: null, requestId });
        logger.error("tool.failed", {
          requestId,
          tool: spec.name,
          durationMs,
          message: error?.message,
          code: error?.code,
        });
        return JSON.stringify({
          error: true,
          message:
            error instanceof AppError
              ? error.publicMessage
              : "That lookup failed. Please try again.",
        });
      }
    },
    { name: spec.name, description: spec.description, schema: spec.schema }
  );
}
