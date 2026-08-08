import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

const app = createApp();

const server = app.listen(env.port, "0.0.0.0",() => {
  logger.info("server.started", {
    port: env.port,
    nodeEnv: env.nodeEnv,
    shopifyApiVersion: env.shopify.apiVersion,
    storeConfigured: Boolean(env.shopify.storeDomain && env.shopify.accessToken),
    toolTesterEnabled: env.enableToolTester,
  });
});

server.setTimeout(60_000);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    logger.info("server.shutdown", { signal });
    server.close(() => process.exit(0));
  });
}

process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandled_rejection", { message: String(reason) });
});
