// Vite plugin: serves the overlay, injects it into the page and stores
// annotations in `.annotate/`. Dev server only; nothing reaches a build.
//
//   import annotate from "dev-annotate/vite";
//   export default { plugins: [annotate()] };
import { resolve } from "node:path";
import { createHandler } from "./server.mjs";

/** @param {{ dir?: string, allowedHosts?: string[] }} [options] */
export default function annotate(options = {}) {
  return {
    name: "dev-annotate",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use(
        createHandler({
          dir: resolve(root, options.dir || ".annotate"),
          cwd: root,
          allowedHosts: options.allowedHosts,
        }),
      );
    },
    transformIndexHtml: () => [
      { tag: "script", attrs: { type: "module", src: "/__annotate/overlay.js" }, injectTo: "body" },
    ],
  };
}
