# dev-annotate

A floating bar for your running dev app. **Pick** elements, **pin notes**, **draw** on the page, then hand it all to Claude Code, Codex or any coding agent, so you stop describing "the third card, the left border, a bit more space" in words.

- **Pick**: hover highlights an element; click drops a numbered pin with your note. Each pin records the selector, visible text, size, computed styles and, when it can, the source file (Vue, React, Svelte, Astro).
- **Draw**: pen, rectangle, arrow in five colors. Each drawing remembers the element under it and can carry a note.
- **Send**: saves `.annotate/latest.json` (+ `latest-shot-N.png`: screenshots with your marks, one per scroll position that has annotations) and copies a one-line prompt. **Copy** puts the full prompt on your clipboard instead, no server needed.
- Everything is dev-only and local. Nothing is added to production builds.

## Install

Vite (Vue, React, Svelte, Astro, SvelteKit …):

```js
// vite.config.js
import annotate from "dev-annotate/vite";
export default { plugins: [annotate()] };
```

Any other dev server (webpack, Next, plain HTML):

```sh
npx dev-annotate serve            # http://127.0.0.1:5178
```

```html
<script type="module" src="http://127.0.0.1:5178/__annotate/overlay.js"></script>
```

Teach your agent (run in the project root):

```sh
npx dev-annotate init             # Claude Code skill + AGENTS.md block for Codex
npx dev-annotate init --claude    # only .claude/skills/annotate/SKILL.md
npx dev-annotate init --codex     # only the AGENTS.md section
```

## Use

1. Open your app. The bar sits at the bottom (drag it, collapse it, **Ctrl+Shift+D** hides it).
2. **P** pick · **D** draw · **1/2/3** pen/rect/arrow · **Ctrl/Cmd+Z** undo · **Esc** leave a mode.
3. Type the overall instruction in the bar, then **Send** and paste the copied line into your agent:
   `Apply my UI annotations: read .annotate/latest.json and the 2 screenshots it lists.`
   With the skill installed you can also just say "apply my annotations".

Screenshots use the browser's tab capture (it asks once per Send). The page scrolls briefly to each group of annotations to capture them, then returns to where you were, so marks you scrolled away from are included. Up to 8 frames for the current route; untick the camera to skip them.

## Cleanup

Each Send replaces the previous `latest.json` and `latest-shot-N.png` and keeps the newest 10 Sends as dated history. Once an agent has applied everything, the skill has it delete the `latest*` files. You can also clean up yourself:

```sh
npx dev-annotate clean         # remove latest.json and latest-shot-*.png
npx dev-annotate clean --all   # also remove the dated history
```

## Safety

The server only answers requests whose `Host` and `Origin` are loopback (`localhost`, `127.0.0.1`), rejects bodies over 25 MB, only accepts PNG data and only writes into the `.annotate/` folder (self-ignoring via its own `.gitignore`, last 10 kept). Add a custom dev domain with `annotate({ allowedHosts: ["myapp.test"] })`.

## Files

| File         | Purpose                                                              |
| ------------ | -------------------------------------------------------------------- |
| `overlay.js` | The bar (vanilla JS, shadow DOM, no dependencies)                    |
| `server.mjs` | Serves the overlay, saves annotations, origin checks                 |
| `vite.mjs`   | Vite plugin: injects the overlay and mounts the server               |
| `cli.mjs`    | `init` (skill + AGENTS.md) and `serve` (standalone)                  |
| `skill/`     | `SKILL.md` for Claude Code, `AGENTS-snippet.md` for Codex and others |
| `test/`      | `node --test test/*.test.mjs`                                        |

## Install from GitHub

```sh
pnpm add -D github:Weltraumakustik/dev-annotate
```

To ship the skill as a Claude Code plugin later, wrap `skill/SKILL.md` in `skills/annotate/SKILL.md` of a plugin with a `.claude-plugin/plugin.json`.

## License

MIT
