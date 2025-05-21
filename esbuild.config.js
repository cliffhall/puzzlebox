import { build } from "esbuild";

build({
  entryPoints: ["src/index.ts", "src/streamableHttp.ts", "src/repl.ts"],
  bundle: true,
  platform: "node",
  target: "node16",
  outdir: "dist/"
}).catch(() => process.exit(1));
