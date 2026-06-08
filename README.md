# Privacy Filter API

`privacy-filter-api` 是一个基于 Hugging Face Transformers.js 的本地隐私信息检测与脱敏 API 服务。

项目使用 OpenAI 发布的 [`openai/privacy-filter`](https://huggingface.co/openai/privacy-filter) 模型，在本机加载 ONNX 模型文件，不需要把待处理文本发送到远程推理服务。它适合用于在日志、对话、工单、文档或其他文本中检测并遮罩 PII（Personally Identifiable Information，个人可识别信息）。

## 功能特性

- 本地运行 `openai/privacy-filter` 模型
- 支持按需下载单一 ONNX 精度，避免一次性下载所有模型文件
- 提供 HTTP API：
  - `GET /health`：健康检查
  - `POST /detect`：检测 PII 实体
  - `POST /mask`：检测并脱敏文本
- 提供 Swagger UI：`/docs`
- 提供 OpenAPI JSON：`/openapi.json`
- 支持 API Key 鉴权
- 支持 `.env` 环境变量配置
- 支持 Docker 部署

## 环境要求

- Node.js >= 20
- npm
- Python 3（仅下载模型时需要，用于调用 `huggingface_hub`）

## 一键安装并启动进程守护

项目提供跨平台一键脚本，支持 macOS、Linux、Windows：从 `git clone` 开始，安装依赖，检查本地模型；如果模型不存在，会让用户选择下载精度，然后用 PM2 启动并守护服务进程。

> 前置要求：目标机器需已安装 Git、Node.js >= 20、npm；首次下载模型还需要 Python 3。

### 从任意目录克隆安装

macOS / Linux / Windows PowerShell 都可执行：

```bash
git clone https://github.com/MayDay-wpf/privacy-filter-api.git privacy-filter-api
cd privacy-filter-api
npm install
npm run install:daemon
```

如果已经有项目仓库，也可直接在项目根目录运行：

```bash
npm run install:daemon
```

常用参数：

```bash
npm run install:daemon -- --dir /opt/privacy-filter-api --precision fp16
npm run install:daemon -- --repo https://github.com/MayDay-wpf/privacy-filter-api.git --dir ./privacy-filter-api
npm run install:daemon -- --yes
npm run install:daemon -- --no-startup
```

说明：

- `--precision` 可选：`fp32`、`fp16`、`q4`、`q4f16`、`quantized`。
- 不传 `--precision` 且未检测到模型时，脚本会交互式询问下载哪种精度，默认 `fp16`。
- 脚本会安装/复用 PM2，并执行 `pm2 start`、`pm2 save`。
- macOS/Linux 的开机自启通常需要按 PM2 输出手动执行一条 `sudo ...` 命令；Windows 会尝试安装并配置 `pm2-windows-startup`。

安装完成后可使用：

```bash
pm2 status
pm2 logs privacy-filter-api
pm2 restart privacy-filter-api
```

## 安装依赖

```bash
cd /Users/helotus/GitHub/privacy-filter-api
npm install
```

## 配置环境变量

建议先复制示例配置：

```bash
cp .env.example .env
```

`.env.example` 内容如下：

```env
PORT=3000
HOST=0.0.0.0
MODEL_ID=openai/privacy-filter
LOCAL_MODEL_ROOT=./models
LOCAL_FILES_ONLY=true
API_KEY=change-me
API_KEY_HEADER=x-api-key
TRANSFORMERS_DTYPE=fp32
# TRANSFORMERS_DEVICE=webgpu
TRANSFORMERS_CACHE=./.cache/transformers
```

### 环境变量说明

| 变量                  | 默认值                  | 作用                                                                                                            |
| --------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PORT`                | `3000`                  | API 服务监听端口。                                                                                              |
| `HOST`                | `0.0.0.0`               | API 服务监听地址。`0.0.0.0` 表示允许局域网/容器外部访问。                                                       |
| `MODEL_ID`            | `openai/privacy-filter` | Transformers.js 加载的模型 ID。配合 `LOCAL_MODEL_ROOT` 使用时，会从本地 `./models/openai/privacy-filter` 加载。 |
| `LOCAL_MODEL_ROOT`    | `./models`              | 本地模型根目录。模型默认下载到 `./models/openai/privacy-filter`。                                               |
| `LOCAL_FILES_ONLY`    | `true`                  | 是否只加载本地模型。`true` 表示不允许启动后从 Hugging Face 远程下载模型文件。生产环境建议保持 `true`。          |
| `API_KEY`             | 空字符串                | API Key。为空时不启用鉴权；设置后 `/detect` 和 `/mask` 必须携带 API Key。                                       |
| `API_KEY_HEADER`      | `x-api-key`             | API Key 请求头名称。默认使用 `x-api-key`。同时也支持 `Authorization: Bearer <API_KEY>`。                        |
| `TRANSFORMERS_DTYPE`  | `fp32`                  | 模型精度，必须和你下载的 ONNX 精度匹配。可用值包括 `fp32`、`fp16`、`q4`、`q4f16`。                              |
| `TRANSFORMERS_DEVICE` | 未设置                  | 推理设备。一般不设置即可；如果运行环境支持 WebGPU，可设置为 `webgpu`。                                          |
| `TRANSFORMERS_CACHE`  | `./.cache/transformers` | Transformers.js 缓存目录。                                                                                      |
| `JSON_LIMIT`          | `2mb`                   | 请求 JSON body 大小限制。该变量没有出现在 `.env.example` 中，但服务端支持配置。                                 |

## 下载模型

模型下载脚本支持只下载一种 ONNX 精度，避免把仓库里的所有模型格式和所有精度都拉下来。

`npm run download:model` 已改为 Node.js 跨平台脚本，可在 macOS/Linux/Windows 直接使用；Unix/macOS 下仍可通过 `bash scripts/download-model.sh` 调用兼容包装脚本。

默认下载位置：

```text
./models/openai/privacy-filter
```

### 下载最高精度 fp32（默认）

```bash
npm run download:model
```

等价于：

```bash
npm run download:model -- fp32
```

下载文件：

```text
onnx/model.onnx
onnx/model.onnx_data*
```

启动时使用：

```bash
npm run start:model -- fp32
```

### 下载 fp16

```bash
npm run download:model -- fp16
```

下载文件：

```text
onnx/model_fp16.onnx
onnx/model_fp16.onnx_data*
```

启动时使用：

```bash
npm run start:model -- fp16
```

### 下载 q4

```bash
npm run download:model -- q4
```

下载文件：

```text
onnx/model_q4.onnx
onnx/model_q4.onnx_data*
```

启动时使用：

```bash
npm run start:model -- q4
```

### 下载 q4f16

```bash
npm run download:model -- q4f16
```

下载文件：

```text
onnx/model_q4f16.onnx
onnx/model_q4f16.onnx_data*
```

启动时使用：

```bash
npm run start:model -- q4f16
```

### 下载 quantized

```bash
npm run download:model -- quantized
```

下载文件：

```text
onnx/model_quantized.onnx
onnx/model_quantized.onnx_data*
```

> 注意：`quantized` 是否能被当前 Transformers.js dtype 直接匹配，取决于 Transformers.js 对该文件命名和 dtype 的支持。如果不确定，优先使用 `q4`、`q4f16`、`fp16` 或 `fp32`。

### 查看下载脚本帮助

```bash
npm run download:model -- --help
```

或者：

```bash
bash scripts/download-model.sh --help
```

### 网络不稳定时禁用 Xet

脚本默认会设置 `HF_HUB_DISABLE_XET=1`。如果需要显式设置，macOS/Linux 可使用：

```bash
HF_HUB_DISABLE_XET=1 npm run download:model -- fp16
```

Windows PowerShell 可使用：

```powershell
$env:HF_HUB_DISABLE_XET="1"; npm run download:model -- fp16
```

如果下载目录里已有不完整文件，可以先清理后重下。macOS/Linux：

```bash
rm -rf ./models/openai/privacy-filter
HF_HUB_DISABLE_XET=1 npm run download:model -- fp16
```

Windows PowerShell：

```powershell
Remove-Item -Recurse -Force .\models\openai\privacy-filter
$env:HF_HUB_DISABLE_XET="1"; npm run download:model -- fp16
```

## 启动服务

### 方式一：使用跨平台运行脚本

假设你下载的是 `fp16`：

```bash
npm run start:model -- fp16
```

假设你下载的是 `q4`：

```bash
npm run start:model -- q4
```

该方式会在启动前设置 `TRANSFORMERS_DTYPE`，macOS/Linux/Windows 都可直接使用。

### 方式二：使用 `.env` 启动

编辑 `.env`：

```env
API_KEY=your-secret-key
TRANSFORMERS_DTYPE=fp16
LOCAL_FILES_ONLY=true
```

然后启动：

```bash
npm start
```

启动后默认监听：

```text
http://127.0.0.1:3000
```

健康检查：

```bash
curl http://127.0.0.1:3000/health
```

## API Key 鉴权

如果 `API_KEY` 为空，则不启用鉴权。

如果设置了：

```env
API_KEY=your-secret-key
API_KEY_HEADER=x-api-key
```

那么 `/detect` 和 `/mask` 必须携带 API Key。

### 使用 x-api-key

```bash
curl -X POST http://127.0.0.1:3000/detect \
  -H 'content-type: application/json' \
  -H 'x-api-key: your-secret-key' \
  -d '{"text":"My name is Harry Potter and my email is harry.potter@hogwarts.edu."}'
```

### 使用 Bearer Token

```bash
curl -X POST http://127.0.0.1:3000/detect \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer your-secret-key' \
  -d '{"text":"My name is Harry Potter and my email is harry.potter@hogwarts.edu."}'
```

公开接口不需要 API Key：

- `GET /health`
- `GET /docs`
- `GET /openapi.json`

## Swagger / OpenAPI

启动服务后访问 Swagger UI：

```text
http://127.0.0.1:3000/docs
```

OpenAPI JSON：

```text
http://127.0.0.1:3000/openapi.json
```

如果设置了 `API_KEY`，在 Swagger 页面右上角点击 `Authorize`：

- `ApiKeyAuth`：填写你的 API Key
- 或 `BearerAuth`：填写你的 API Key 作为 Bearer Token

## API 使用示例

### 健康检查

```bash
curl http://127.0.0.1:3000/health
```

示例返回：

```json
{
  "ok": true,
  "model": "openai/privacy-filter",
  "loaded": false,
  "auth": "enabled"
}
```

`loaded:false` 表示模型尚未被首次请求触发加载，这是正常现象。第一次调用 `/detect` 或 `/mask` 时才会加载模型。

### 检测 PII

```bash
curl -X POST http://127.0.0.1:3000/detect \
  -H 'content-type: application/json' \
  -H 'x-api-key: your-secret-key' \
  -d '{"text":"My name is Harry Potter and my email is harry.potter@hogwarts.edu."}'
```

示例返回：

```json
{
  "model": "openai/privacy-filter",
  "entities": [
    {
      "label": "private_person",
      "score": 0.9999,
      "text": " Harry Potter",
      "start": 10,
      "end": 23
    },
    {
      "label": "private_email",
      "score": 0.9999,
      "text": " harry.potter@hogwarts.edu",
      "start": 40,
      "end": 67
    }
  ]
}
```

### 脱敏文本

```bash
curl -X POST http://127.0.0.1:3000/mask \
  -H 'content-type: application/json' \
  -H 'x-api-key: your-secret-key' \
  -d '{"text":"My name is Harry Potter and my email is harry.potter@hogwarts.edu.","mask_token":"[{label}]"}'
```

示例返回：

```json
{
  "model": "openai/privacy-filter",
  "masked_text": "My name is [private_person] and my email is [private_email].",
  "entities": []
}
```

> 实际 `entities` 会返回模型识别出的实体列表，示例仅展示结构和脱敏效果。

## Docker 部署

### 构建镜像

默认构建轻量镜像，不把模型打进镜像，推荐运行时挂载 `./models`：

```bash
docker build -t privacy-filter-api .
```

如果希望构建时预下载模型并打进镜像，可以使用 build args，例如打包 `fp16`：

```bash
docker build \
  --build-arg DOWNLOAD_MODEL=true \
  --build-arg MODEL_PRECISION=fp16 \
  -t privacy-filter-api:fp16 .
```

可用 `MODEL_PRECISION`：`fp32`、`fp16`、`q4`、`q4f16`、`quantized`。

### 运行容器

推荐把本地模型目录挂载进容器，避免镜像过大：

```bash
docker run --rm \
  -p 3000:3000 \
  -e API_KEY=your-secret-key \
  -e TRANSFORMERS_DTYPE=fp16 \
  -e LOCAL_FILES_ONLY=true \
  -v "$PWD/models:/app/models" \
  -v "$PWD/.cache:/app/.cache" \
  privacy-filter-api
```

如果镜像中已经预下载模型，则可以不挂载 `models`：

```bash
docker run --rm \
  -p 3000:3000 \
  -e API_KEY=your-secret-key \
  -e TRANSFORMERS_DTYPE=fp16 \
  privacy-filter-api:fp16
```

访问：

```text
http://127.0.0.1:3000/docs
```

## 常用命令

```bash
# 安装依赖
npm install

# 下载模型，默认 fp32
npm run download:model

# 下载指定精度
npm run download:model -- fp16
npm run download:model -- q4

# 启动服务
npm start

# 开发模式，文件变化自动重启
npm run dev

# 语法检查
npm run check

# 服务启动后执行 smoke 测试
npm run smoke
```

## 故障排查

### Unsupported model type: openai_privacy_filter

请确认 `@huggingface/transformers` 版本为 `4.2.0` 或更新版本：

```bash
node -p "require('./node_modules/@huggingface/transformers/package.json').version"
```

如果版本较低，执行：

```bash
npm install @huggingface/transformers@latest
```

### 下载模型时出现 Xet / TLS / EOF 错误

可以禁用 Xet 后重试：

```bash
HF_HUB_DISABLE_XET=1 npm run download:model -- fp16
```

如果使用 macOS 自带 Python 遇到 SSL 问题，建议安装 Homebrew Python：

```bash
brew install python
python3 -c "import ssl; print(ssl.OPENSSL_VERSION)"
```

### 请求返回 401 Unauthorized

说明已经启用 `API_KEY`，请求需要添加：

```bash
-H 'x-api-key: your-secret-key'
```

或：

```bash
-H 'Authorization: Bearer your-secret-key'
```
