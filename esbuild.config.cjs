const { build } = require("esbuild");

build({
  entryPoints: ["src/stdio.ts", "src/sse.ts"],
  bundle: true,
  platform: "node",
  target: "node16",
  outdir: "dist/"
}).catch(() => process.exit(1));
