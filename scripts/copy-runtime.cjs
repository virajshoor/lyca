const { cpSync, mkdirSync } = require("node:fs");
mkdirSync("dist/runtime", { recursive: true });
cpSync("src/runtime", "dist/runtime", { recursive: true });
