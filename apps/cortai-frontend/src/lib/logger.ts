import pino from "pino";

export const logger = pino({
  name: "cortai-frontend",
  level: process.env.LOG_LEVEL ?? "info"
});
