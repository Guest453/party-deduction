import { readFileSync, writeFileSync } from "node:fs";

// Cache-bust the bundle URL (GitHub Pages serves max-age=600).
const p = new URL("../index.html", import.meta.url);
const h = readFileSync(p, "utf8");
const stamp = process.env.BUILD_STAMP || String(Date.now());
writeFileSync(p, h.replace(/dist\/bundle\.js(\?v=[^"]*)?/g, `dist/bundle.js?v=${stamp}`));
console.log("bundle stamp:", stamp);
