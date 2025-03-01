const { build } = require("esbuild");

build({
  entryPoints: ["src/server/index.ts"],
  bundle: true,
  platform: "node",
  target: "node16",
  outfile: "dist/server/index.cjs",
  external: [
    "express",
    "fs",
    "path",
    "net",
    "stream",
    "url",
    // List other Node.js built-in modules you need to keep externalized
  ],
}).catch(() => process.exit(1));
