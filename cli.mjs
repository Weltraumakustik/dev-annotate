#!/usr/bin/env node
// dev-annotate init  [--claude] [--codex]   install the agent skill / AGENTS.md block
// dev-annotate clean [--all] [--dir .annotate]   remove the latest annotations (--all: the history too)
// dev-annotate serve [--port 5178] [--dir .annotate]   standalone server for non-Vite setups
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "./server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const START = "<!-- dev-annotate:start -->",
  END = "<!-- dev-annotate:end -->";

if (cmd === "init") init();
else if (cmd === "clean") clean();
else if (cmd === "serve") serve();
else
  console.log("Usage:\n  dev-annotate init [--claude] [--codex]\n  dev-annotate clean [--all]\n  dev-annotate serve [--port 5178] [--dir .annotate]");

function init() {
  const both = !flag("claude") && !flag("codex");
  if (both || flag("claude")) {
    const dest = join(process.cwd(), ".claude/skills/annotate/SKILL.md");
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(here, "skill/SKILL.md")));
    console.log("✓ Claude Code skill: .claude/skills/annotate/SKILL.md");
  }
  if (both || flag("codex")) {
    const file = join(process.cwd(), "AGENTS.md");
    const block = `${START}\n${readFileSync(join(here, "skill/AGENTS-snippet.md"), "utf8").trim()}\n${END}\n`;
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (current.includes(START))
      writeFileSync(file, current.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`), block));
    else appendFileSync(file, (current && !current.endsWith("\n\n") ? "\n" : "") + block);
    console.log("✓ Codex / generic agents: AGENTS.md (annotate section)");
  }
  const ignore = join(process.cwd(), ".gitignore");
  if (!existsSync(ignore) || !readFileSync(ignore, "utf8").split("\n").includes(".annotate/")) {
    appendFileSync(ignore, ".annotate/\n");
    console.log("✓ .gitignore: .annotate/");
  }
  console.log(
    "\nNext: add the overlay to your dev server (Vite: `plugins: [annotate()]`, others: `npx dev-annotate serve`). See the README.",
  );
}

function clean() {
  const dir = join(process.cwd(), opt("dir", ".annotate"));
  if (!existsSync(dir)) return console.log("Nothing to clean.");
  const all = flag("all");
  // Only ever remove files this tool wrote, never anything else in the folder.
  const mine = all
    ? /^(latest|\d{4}-\d\d-\d\dT[\d-]+Z)(-shot-\d+\.png|\.json)$/
    : /^latest(-shot-\d+\.png|\.json)$/;
  const doomed = readdirSync(dir).filter((f) => mine.test(f));
  for (const f of doomed) rmSync(join(dir, f), { force: true });
  console.log(
    `Removed ${doomed.length} file${doomed.length === 1 ? "" : "s"} from ${opt("dir", ".annotate")}/${all ? "" : " (history kept; use --all to remove it too)"}`,
  );
}

function serve() {
  const port = Number(opt("port", 5178));
  const handler = createHandler({ dir: opt("dir", ".annotate") });
  createServer((req, res) =>
    handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  ).listen(port, "127.0.0.1", () => {
    console.log(
      `dev-annotate listening on http://127.0.0.1:${port}\nAdd to your dev page:\n  <script type="module" src="http://127.0.0.1:${port}/__annotate/overlay.js"></script>`,
    );
  });
}
