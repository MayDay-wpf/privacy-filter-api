#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

function usage() {
  console.log(`Usage: npm run download:model -- [precision]
       node scripts/download-model.js [precision]

precision:
  fp32       最高精度，下载 onnx/model.onnx 和外部 data 文件（默认）
  fp16       半精度，下载 onnx/model_fp16.onnx 和外部 data 文件
  q4         4-bit 量化，下载 onnx/model_q4.onnx 和外部 data 文件
  q4f16      fp16 + int4 block weight quantization，下载 onnx/model_q4f16.onnx 和外部 data 文件
  quantized  下载 onnx/model_quantized.onnx 和外部 data 文件

环境变量：
  MODEL_ID=openai/privacy-filter
  LOCAL_MODEL_ROOT=./models
  MODEL_PRECISION=fp32
  HF_HUB_DISABLE_XET=1`);
}

const precision = process.argv[2] || process.env.MODEL_PRECISION || "fp32";
const precisionMap = {
  fp32: ["model", "fp32"],
  fp16: ["model_fp16", "fp16"],
  q4: ["model_q4", "q4"],
  q4f16: ["model_q4f16", "q4f16"],
  quantized: ["model_quantized", "quantized"],
};

if (["-h", "--help", "help"].includes(precision)) {
  usage();
  process.exit(0);
}

if (!Object.hasOwn(precisionMap, precision)) {
  console.error(`Unsupported precision: ${precision}`);
  usage();
  process.exit(1);
}

const [onnxBasename, dtypeHint] = precisionMap[precision];
const modelId = process.env.MODEL_ID || "openai/privacy-filter";
const localModelRoot = process.env.LOCAL_MODEL_ROOT || "./models";
const targetDir = path.join(localModelRoot, ...modelId.split("/"));

mkdirSync(targetDir, { recursive: true });

const python = findPython();
if (!python) {
  console.error("Python 3 is required to download the model snapshot.");
  console.error(
    "Please install Python 3 and make sure python3, python, or py is available in PATH."
  );
  process.exit(1);
}

const env = {
  ...process.env,
  HF_HUB_DISABLE_XET: process.env.HF_HUB_DISABLE_XET || "1",
  MODEL_ID: modelId,
  LOCAL_MODEL_ROOT: localModelRoot,
  ONNX_BASENAME: onnxBasename,
  PRECISION: precision,
  TRANSFORMERS_DTYPE_HINT: dtypeHint,
};

runPython(
  python,
  `
import importlib.util
import subprocess
import sys

if importlib.util.find_spec("huggingface_hub") is None:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "huggingface_hub"])
`,
  env
);

runPython(
  python,
  `
import os
from huggingface_hub import snapshot_download

model_id = os.environ.get("MODEL_ID", "openai/privacy-filter")
local_model_root = os.environ.get("LOCAL_MODEL_ROOT", "./models")
onnx_basename = os.environ["ONNX_BASENAME"]
precision = os.environ["PRECISION"]
dtype_hint = os.environ["TRANSFORMERS_DTYPE_HINT"]
target_dir = os.path.join(local_model_root, *model_id.split("/"))

allow_patterns = [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "viterbi_calibration.json",
    f"onnx/{onnx_basename}.onnx",
    f"onnx/{onnx_basename}.onnx_data*",
]

print(f"Downloading {model_id} [{precision}] to {target_dir} ...")
print("Files:")
for pattern in allow_patterns:
    print(f"  - {pattern}")

snapshot_download(
    repo_id=model_id,
    local_dir=target_dir,
    allow_patterns=allow_patterns,
)

print("Done.")
print(f"Start hint: npm run start:model -- {dtype_hint}")
`,
  env
);

function findPython() {
  const candidates =
    process.platform === "win32"
      ? [
          ["py", ["-3"]],
          ["python", []],
          ["python3", []],
        ]
      : [
          ["python3", []],
          ["python", []],
        ];

  for (const [command, prefixArgs] of candidates) {
    const result = spawnSync(command, [...prefixArgs, "--version"], {
      encoding: "utf8",
      stdio: "pipe",
    });

    if (result.status === 0) {
      return { command, prefixArgs };
    }
  }

  return null;
}

function runPython(python, code, env) {
  const result = spawnSync(python.command, [...python.prefixArgs, "-c", code], {
    env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
