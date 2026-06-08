#!/usr/bin/env node

const arg = process.argv[2];

if (["-h", "--help", "help"].includes(arg)) {
  console.log(`Usage: npm run start:model -- [precision]
       node scripts/run.js [precision]

precision:
  fp32 | fp16 | q4 | q4f16 | quantized

Examples:
  npm run start:model -- fp16
  npm run start:model -- q4

If precision is omitted, TRANSFORMERS_DTYPE from .env or the current environment is used.`);
  process.exit(0);
}

if (arg) {
  process.env.TRANSFORMERS_DTYPE = arg;
}

await import("../src/server.js");
