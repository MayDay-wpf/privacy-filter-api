#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: npm run download:model -- [precision]
       bash scripts/download-model.sh [precision]

precision:
  fp32       最高精度，下载 onnx/model.onnx 和外部 data 文件（默认）
  fp16       半精度，下载 onnx/model_fp16.onnx 和外部 data 文件
  q4         4-bit 量化，下载 onnx/model_q4.onnx 和外部 data 文件
  q4f16      fp16 + int4 block weight quantization，下载 onnx/model_q4f16.onnx 和外部 data 文件
  quantized  下载 onnx/model_quantized.onnx 和外部 data 文件

环境变量：
  MODEL_ID=openai/privacy-filter
  LOCAL_MODEL_ROOT=./models
  HF_HUB_DISABLE_XET=1
EOF
}

MODEL_ID="${MODEL_ID:-openai/privacy-filter}"
LOCAL_MODEL_ROOT="${LOCAL_MODEL_ROOT:-./models}"
PRECISION="${1:-${MODEL_PRECISION:-fp32}}"
TARGET_DIR="${LOCAL_MODEL_ROOT}/${MODEL_ID}"

case "${PRECISION}" in
  fp32)
    ONNX_BASENAME="model"
    TRANSFORMERS_DTYPE_HINT="fp32"
    ;;
  fp16)
    ONNX_BASENAME="model_fp16"
    TRANSFORMERS_DTYPE_HINT="fp16"
    ;;
  q4)
    ONNX_BASENAME="model_q4"
    TRANSFORMERS_DTYPE_HINT="q4"
    ;;
  q4f16)
    ONNX_BASENAME="model_q4f16"
    TRANSFORMERS_DTYPE_HINT="q4f16"
    ;;
  quantized)
    ONNX_BASENAME="model_quantized"
    TRANSFORMERS_DTYPE_HINT="quantized"
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    echo "Unsupported precision: ${PRECISION}" >&2
    usage >&2
    exit 1
    ;;
esac

# 避免部分网络环境下 Hugging Face Xet CAS 的 TLS 握手失败，默认走普通 HF 下载。
export HF_HUB_DISABLE_XET="${HF_HUB_DISABLE_XET:-1}"
export MODEL_ID LOCAL_MODEL_ROOT ONNX_BASENAME PRECISION TRANSFORMERS_DTYPE_HINT

mkdir -p "${TARGET_DIR}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to download the model snapshot." >&2
  exit 1
fi

python3 - <<'PY'
import importlib.util
import subprocess
import sys

if importlib.util.find_spec("huggingface_hub") is None:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "huggingface_hub"])
PY

python3 - <<'PY'
import os
from huggingface_hub import snapshot_download

model_id = os.environ.get("MODEL_ID", "openai/privacy-filter")
local_model_root = os.environ.get("LOCAL_MODEL_ROOT", "./models")
onnx_basename = os.environ["ONNX_BASENAME"]
precision = os.environ["PRECISION"]
dtype_hint = os.environ["TRANSFORMERS_DTYPE_HINT"]
target_dir = os.path.join(local_model_root, model_id)

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
print(f"Start hint: TRANSFORMERS_DTYPE={dtype_hint} npm start")
PY
