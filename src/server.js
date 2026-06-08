import "dotenv/config";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = process.env.MODEL_ID || "openai/privacy-filter";
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DEVICE = process.env.TRANSFORMERS_DEVICE || undefined;
const DTYPE = process.env.TRANSFORMERS_DTYPE || "fp32";
const LOCAL_MODEL_ROOT = process.env.LOCAL_MODEL_ROOT || "./models";
const CACHE_DIR = process.env.TRANSFORMERS_CACHE || "./.cache/transformers";
const LOCAL_FILES_ONLY = process.env.LOCAL_FILES_ONLY !== "false";
const API_KEY = process.env.API_KEY || "";
const API_KEY_HEADER = (
  process.env.API_KEY_HEADER || "x-api-key"
).toLowerCase();

env.localModelPath = LOCAL_MODEL_ROOT;
env.cacheDir = CACHE_DIR;
env.allowRemoteModels = !LOCAL_FILES_ONLY;

let classifierPromise;

function getClassifier() {
  if (!classifierPromise) {
    const options = {
      dtype: DTYPE,
      local_files_only: LOCAL_FILES_ONLY,
    };

    if (DEVICE) {
      options.device = DEVICE;
    }

    classifierPromise = pipeline("token-classification", MODEL_ID, options);
  }

  return classifierPromise;
}

function normalizeEntities(entities) {
  return entities.map((entity) => ({
    label: entity.entity_group || entity.entity || "unknown",
    score: entity.score,
    text: entity.word,
    start: Number.isInteger(entity.start) ? entity.start : null,
    end: Number.isInteger(entity.end) ? entity.end : null,
  }));
}

function maskByOffsets(text, entities, maskToken) {
  const sortedEntities = entities
    .filter(
      (entity) =>
        Number.isInteger(entity.start) &&
        Number.isInteger(entity.end) &&
        entity.start < entity.end
    )
    .sort((a, b) => a.start - b.start);

  if (sortedEntities.length === 0) {
    return null;
  }

  const parts = [];
  let cursor = 0;

  for (const entity of sortedEntities) {
    if (entity.start < cursor) {
      continue;
    }

    parts.push(text.slice(cursor, entity.start));
    parts.push(maskToken.replace("{label}", entity.label));
    cursor = entity.end;
  }

  parts.push(text.slice(cursor));
  return parts.join("");
}

function maskByText(text, entities, maskToken) {
  let masked = text;

  for (const entity of entities) {
    const value = String(entity.text || "").trim();
    if (!value) {
      continue;
    }

    masked = masked.replaceAll(
      value,
      maskToken.replace("{label}", entity.label)
    );
  }

  return masked;
}

function redactText(text, entities, maskToken = "[{label}]") {
  return (
    maskByOffsets(text, entities, maskToken) ??
    maskByText(text, entities, maskToken)
  );
}

function isPublicRoute(req) {
  return (
    req.path === "/health" ||
    req.path === "/openapi.json" ||
    req.path === "/docs" ||
    req.path.startsWith("/docs/")
  );
}

function requireApiKey(req, res, next) {
  if (!API_KEY || isPublicRoute(req)) {
    return next();
  }

  const headerValue = req.get(API_KEY_HEADER);
  const bearerToken = req.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (headerValue === API_KEY || bearerToken === API_KEY) {
    return next();
  }

  return res.status(401).json({ error: "Unauthorized." });
}

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Privacy Filter API",
    version: "1.0.0",
    description:
      "Local API for openai/privacy-filter using Hugging Face Transformers.js.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: API_KEY_HEADER,
      },
      BearerAuth: {
        type: "http",
        scheme: "bearer",
      },
    },
    schemas: {
      Entity: {
        type: "object",
        properties: {
          label: { type: "string", example: "private_person" },
          score: { type: "number", example: 0.9999 },
          text: { type: "string", example: " Harry Potter" },
          start: { type: "integer", nullable: true, example: 10 },
          end: { type: "integer", nullable: true, example: 23 },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        security: [],
        responses: {
          200: {
            description: "Service status",
          },
        },
      },
    },
    "/detect": {
      post: {
        summary: "Detect PII entities",
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["text"],
                properties: {
                  text: {
                    type: "string",
                    example:
                      "My name is Harry Potter and my email is harry.potter@hogwarts.edu.",
                  },
                  aggregation_strategy: { type: "string", default: "simple" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Detected entities",
          },
          400: { description: "Invalid request" },
          401: { description: "Unauthorized" },
        },
      },
    },
    "/mask": {
      post: {
        summary: "Detect and mask PII entities",
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["text"],
                properties: {
                  text: {
                    type: "string",
                    example:
                      "My name is Harry Potter and my email is harry.potter@hogwarts.edu.",
                  },
                  aggregation_strategy: { type: "string", default: "simple" },
                  mask_token: { type: "string", default: "[{label}]" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Masked text and entities" },
          400: { description: "Invalid request" },
          401: { description: "Unauthorized" },
        },
      },
    },
  },
};

const app = express();
app.use(express.json({ limit: process.env.JSON_LIMIT || "2mb" }));
app.use(requireApiKey);

app.get("/openapi.json", (req, res) => {
  res.json(openApiSpec);
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    model: MODEL_ID,
    loaded: Boolean(classifierPromise),
    auth: API_KEY ? "enabled" : "disabled",
  });
});

app.post("/detect", async (req, res, next) => {
  try {
    const { text, aggregation_strategy = "simple" } = req.body || {};

    if (typeof text !== "string" || text.length === 0) {
      return res
        .status(400)
        .json({ error: "`text` must be a non-empty string." });
    }

    const classifier = await getClassifier();
    const rawEntities = await classifier(text, { aggregation_strategy });
    const entities = normalizeEntities(rawEntities);

    return res.json({
      model: MODEL_ID,
      entities,
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/mask", async (req, res, next) => {
  try {
    const {
      text,
      aggregation_strategy = "simple",
      mask_token = "[{label}]",
    } = req.body || {};

    if (typeof text !== "string" || text.length === 0) {
      return res
        .status(400)
        .json({ error: "`text` must be a non-empty string." });
    }

    const classifier = await getClassifier();
    const rawEntities = await classifier(text, { aggregation_strategy });
    const entities = normalizeEntities(rawEntities);

    return res.json({
      model: MODEL_ID,
      masked_text: redactText(text, entities, mask_token),
      entities,
    });
  } catch (error) {
    return next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    error: "Inference failed.",
    message: error instanceof Error ? error.message : String(error),
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Privacy Filter API listening on http://${HOST}:${PORT}`);
  console.log(
    `Model: ${MODEL_ID}; dtype: ${DTYPE}; device: ${
      DEVICE || "auto/default"
    }; cache: ${CACHE_DIR}`
  );
});
