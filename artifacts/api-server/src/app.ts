import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be configured.");
}

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser(sessionSecret));
// A 100 KB pasted/file batch expands when card fields are serialized as JSON.
// Allow headroom for that request shape while keeping a strict upper bound.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found." });
});
const jsonErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const parserError = error as { type?: unknown };
  if (parserError.type === "entity.too.large") {
    req.log.warn(
      { requestId: req.id },
      "Rejected a request body that exceeded the JSON size limit.",
    );
    res.status(413).json({
      error:
        "The request is too large. Split the stock upload into smaller batches and retry.",
    });
    return;
  }
  if (parserError.type === "entity.parse.failed") {
    req.log.warn(
      { requestId: req.id },
      "Rejected a request with invalid JSON.",
    );
    res.status(400).json({
      error: "The request body could not be parsed. Review the data and retry.",
    });
    return;
  }
  req.log.error({ err: error }, "Unhandled API request");
  res.status(500).json({
    error: `An unexpected error occurred. Reference ID: ${req.id}`,
  });
};
app.use(jsonErrorHandler);

export default app;
