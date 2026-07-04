import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const targetPath = join(process.cwd(), "node_modules", "sixel", "upng.js");
const unsafeLine = "module.exports = UPNG = {};";
const safeLine = "var UPNG = {};\nmodule.exports = UPNG;";

if (!existsSync(targetPath)) {
  process.exit(0);
}

const source = readFileSync(targetPath, "utf8");
if (!source.includes(unsafeLine)) {
  process.exit(0);
}

const patched = source.replace(unsafeLine, safeLine);
writeFileSync(targetPath, patched, "utf8");
