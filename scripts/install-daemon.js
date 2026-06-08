#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DEFAULT_REPO_URL = "https://github.com/MayDay-wpf/privacy-filter-api.git";
const SERVICE_NAME = "privacy-filter-api";
const MODEL_ID_DEFAULT = "openai/privacy-filter";
const PRECISIONS = {
  fp32: { dtype: "fp32", files: ["model.onnx"] },
  fp16: { dtype: "fp16", files: ["model_fp16.onnx"] },
  q4: { dtype: "q4", files: ["model_q4.onnx"] },
  q4f16: { dtype: "q4f16", files: ["model_q4f16.onnx"] },
  quantized: { dtype: "quantized", files: ["model_quantized.onnx"] },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const currentProjectRoot = path.resolve(__dirname, "..");

function usage() {
  console.log(`Usage:
  node scripts/install-daemon.js [options]

Options:
  --repo <url>             Git repository URL. Default: ${DEFAULT_REPO_URL}
  --dir <path>             Install directory. Default: current project when run inside repo, otherwise ./privacy-filter-api
  --precision <precision>  Model precision: fp32 | fp16 | q4 | q4f16 | quantized
  --name <name>            PM2 process name. Default: ${SERVICE_NAME}
  --no-clone               Do not clone, install in --dir/current project only
  --no-startup             Start with PM2 but skip OS boot startup registration
  --yes                    Non-interactive mode; default missing model precision to fp16
  -h, --help               Show help

Examples:
  node scripts/install-daemon.js
  node scripts/install-daemon.js --dir /opt/privacy-filter-api --precision fp16
  node scripts/install-daemon.js --repo https://github.com/MayDay-wpf/privacy-filter-api.git --dir ./privacy-filter-api`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

const rl = readline.createInterface({ input, output });

try {
  const repoUrl = args.repo || DEFAULT_REPO_URL;
  const processName = args.name || SERVICE_NAME;
  const targetDir = path.resolve(
    args.dir ||
      (isProjectRoot(process.cwd()) ? process.cwd() : "privacy-filter-api")
  );
  const skipClone = Boolean(args.noClone) || isProjectRoot(targetDir);
  const skipStartup = Boolean(args.noStartup);
  const assumeYes = Boolean(args.yes);

  console.log(
    `\n==> Privacy Filter API one-click installer (${platformLabel()})`
  );
  console.log(`    Repository : ${repoUrl}`);
  console.log(`    Directory  : ${targetDir}`);
  console.log(`    PM2 name   : ${processName}\n`);

  ensureCommand("git", "Git is required to clone the project.");
  ensureCommand("node", "Node.js >= 20 is required.");
  ensureCommand("npm", "npm is required.");
  ensureNodeVersion();

  if (!skipClone) {
    cloneProject(repoUrl, targetDir);
  } else if (!isProjectRoot(targetDir)) {
    throw new Error(
      `Target directory is not a privacy-filter-api project: ${targetDir}`
    );
  } else {
    console.log("==> Project already exists, skip clone.");
  }

  process.chdir(targetDir);
  ensureEnvFile(targetDir);

  console.log("==> Installing npm dependencies...");
  run("npm", ["install"], { cwd: targetDir });

  let precision = normalizePrecision(args.precision);
  const existing = detectInstalledPrecisions(targetDir);
  if (existing.length > 0) {
    console.log(
      `==> Existing model precision detected: ${existing.join(", ")}`
    );
    if (!precision) {
      precision = existing[0];
    }
  }

  if (!precision || !hasModelPrecision(targetDir, precision)) {
    precision = await choosePrecision(precision, assumeYes);
    console.log(`==> Downloading model precision: ${precision}`);
    run("npm", ["run", "download:model", "--", precision], {
      cwd: targetDir,
      env: {
        ...process.env,
        HF_HUB_DISABLE_XET: process.env.HF_HUB_DISABLE_XET || "1",
      },
    });
  }

  updateEnvValue(
    path.join(targetDir, ".env"),
    "TRANSFORMERS_DTYPE",
    PRECISIONS[precision].dtype
  );
  updateEnvValue(path.join(targetDir, ".env"), "LOCAL_FILES_ONLY", "true");

  ensurePm2();
  startWithPm2(targetDir, processName, precision);

  if (!skipStartup) {
    configureStartup(targetDir);
  } else {
    console.log("==> Skip OS boot startup registration (--no-startup).");
  }

  console.log(`\n✅ Done. Service is guarded by PM2.

Useful commands:
  pm2 status
  pm2 logs ${processName}
  pm2 restart ${processName}
  pm2 stop ${processName}

Health check:
  http://127.0.0.1:${
    readEnvValue(path.join(targetDir, ".env"), "PORT") || "3000"
  }/health\n`);
} finally {
  rl.close();
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") parsed.help = true;
    else if (arg === "--repo") parsed.repo = requireValue(argv, ++i, arg);
    else if (arg === "--dir") parsed.dir = requireValue(argv, ++i, arg);
    else if (arg === "--precision")
      parsed.precision = requireValue(argv, ++i, arg);
    else if (arg === "--name") parsed.name = requireValue(argv, ++i, arg);
    else if (arg === "--no-clone") parsed.noClone = true;
    else if (arg === "--no-startup") parsed.noStartup = true;
    else if (arg === "--yes" || arg === "-y") parsed.yes = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return parsed;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function platformLabel() {
  if (process.platform === "darwin") return "macOS";
  if (process.platform === "linux") return "Linux";
  if (process.platform === "win32") return "Windows";
  return process.platform;
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "command";
  const argsForChecker =
    process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(checker, argsForChecker, {
    stdio: "ignore",
    shell: process.platform !== "win32",
  });
  return result.status === 0;
}

function ensureCommand(command, message) {
  if (!commandExists(command)) {
    throw new Error(`${message}\nMissing command: ${command}`);
  }
}

function ensureNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    throw new Error(
      `Node.js >= 20 is required. Current version: ${process.version}`
    );
  }
}

function isProjectRoot(dir) {
  return (
    existsSync(path.join(dir, "package.json")) &&
    existsSync(path.join(dir, "src", "server.js"))
  );
}

function cloneProject(repoUrl, targetDir) {
  if (existsSync(targetDir)) {
    if (isProjectRoot(targetDir)) {
      console.log("==> Target project exists, skip clone.");
      return;
    }
    throw new Error(
      `Target directory already exists and is not this project: ${targetDir}`
    );
  }

  mkdirSync(path.dirname(targetDir), { recursive: true });
  console.log("==> Cloning project...");
  run("git", ["clone", repoUrl, targetDir]);
}

function ensureEnvFile(projectRoot) {
  const envPath = path.join(projectRoot, ".env");
  const examplePath = path.join(projectRoot, ".env.example");
  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    console.log("==> Created .env from .env.example");
  }
}

function normalizePrecision(precision) {
  if (!precision) return null;
  const normalized = precision.toLowerCase();
  if (!Object.hasOwn(PRECISIONS, normalized)) {
    throw new Error(
      `Unsupported precision: ${precision}. Use one of: ${Object.keys(
        PRECISIONS
      ).join(", ")}`
    );
  }
  return normalized;
}

function modelDir(projectRoot) {
  const envPath = path.join(projectRoot, ".env");
  const modelId = readEnvValue(envPath, "MODEL_ID") || MODEL_ID_DEFAULT;
  const localRoot = readEnvValue(envPath, "LOCAL_MODEL_ROOT") || "./models";
  return path.resolve(projectRoot, localRoot, ...modelId.split("/"));
}

function detectInstalledPrecisions(projectRoot) {
  return Object.keys(PRECISIONS).filter((precision) =>
    hasModelPrecision(projectRoot, precision)
  );
}

function hasModelPrecision(projectRoot, precision) {
  const onnxDir = path.join(modelDir(projectRoot), "onnx");
  return PRECISIONS[precision].files.every((file) =>
    existsSync(path.join(onnxDir, file))
  );
}

async function choosePrecision(requestedPrecision, assumeYes) {
  if (requestedPrecision) return requestedPrecision;
  if (assumeYes) return "fp16";

  console.log(
    "\nNo usable local model was found. Choose a precision to download:"
  );
  const options = Object.keys(PRECISIONS);
  options.forEach((precision, index) => {
    console.log(`  ${index + 1}) ${precision}`);
  });

  while (true) {
    const answer = (await rl.question("Download precision [2=fp16]: "))
      .trim()
      .toLowerCase();
    if (!answer) return "fp16";
    if (Object.hasOwn(PRECISIONS, answer)) return answer;
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= options.length) {
      return options[index - 1];
    }
    console.log(
      `Please enter one of: ${options.join(", ")} or 1-${options.length}.`
    );
  }
}

function ensurePm2() {
  if (commandExists("pm2")) {
    return;
  }

  console.log("==> PM2 is not installed. Installing PM2 globally...");
  run("npm", ["install", "-g", "pm2"]);

  if (!commandExists("pm2")) {
    throw new Error(
      "PM2 installation finished but pm2 is still unavailable in PATH. Please reopen the terminal or check npm global bin path."
    );
  }
}

function startWithPm2(projectRoot, processName, precision) {
  console.log("==> Starting service with PM2...");
  run("pm2", ["delete", processName], { cwd: projectRoot, allowFailure: true });
  run(
    "pm2",
    [
      "start",
      path.join("scripts", "run.js"),
      "--name",
      processName,
      "--cwd",
      projectRoot,
      "--time",
      "--",
      precision,
    ],
    { cwd: projectRoot }
  );
  run("pm2", ["save"], { cwd: projectRoot });
}

function configureStartup(projectRoot) {
  console.log(`==> Configuring boot startup for ${platformLabel()}...`);

  if (process.platform === "win32") {
    if (!commandExists("pm2-startup")) {
      console.log("==> Installing pm2-windows-startup globally...");
      run("npm", ["install", "-g", "pm2-windows-startup"], {
        allowFailure: true,
      });
    }
    if (commandExists("pm2-startup")) {
      run("pm2-startup", ["install"], { cwd: projectRoot, allowFailure: true });
      run("pm2", ["save"], { cwd: projectRoot });
    } else {
      console.warn(
        "⚠ Could not find pm2-startup. PM2 is running now, but Windows boot startup was not registered."
      );
      console.warn(
        "  You can run later: npm install -g pm2-windows-startup && pm2-startup install && pm2 save"
      );
    }
    return;
  }

  const result = spawnSync("pm2", ["startup"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const combined = `${result.stdout || ""}${result.stderr || ""}`;
  process.stdout.write(combined);

  const sudoCommand = combined
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith("sudo "));
  if (sudoCommand) {
    console.warn(
      "\n⚠ PM2 needs the following command to enable boot startup. Run it manually, then run `pm2 save`:"
    );
    console.warn(`  ${sudoCommand.trim()}\n`);
  }

  run("pm2", ["save"], { cwd: projectRoot });
}

function readEnvValue(envPath, key) {
  if (!existsSync(envPath)) return null;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match?.[1] === key) {
      return match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return null;
}

function updateEnvValue(envPath, key, value) {
  const lines = existsSync(envPath)
    ? readFileSync(envPath, "utf8").split(/\r?\n/)
    : [];
  let updated = false;
  const nextLines = lines.map((line) => {
    if (line.match(new RegExp(`^${key}=`))) {
      updated = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!updated) {
    nextLines.push(`${key}=${value}`);
  }

  writeFileSync(
    envPath,
    `${nextLines
      .filter((line, index) => index < nextLines.length - 1 || line !== "")
      .join("\n")}\n`
  );
}

function run(command, argsForCommand, options = {}) {
  const result = spawnSync(command, argsForCommand, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    if (options.allowFailure) return result;
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`Command failed: ${command} ${argsForCommand.join(" ")}`);
  }

  return result;
}
