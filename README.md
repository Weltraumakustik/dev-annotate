# dev-annotate

A small bar for your running dev app. Pick elements, pin notes and draw on the page, then send it to your coding agent as a prompt with screenshots.

Dev only and local. Nothing is added to production builds.

## Install

```sh
pnpm add -D github:Weltraumakustik/dev-annotate
```

Vite:

```js
import annotate from "dev-annotate/vite";
export default { plugins: [annotate()] };
```

Other dev servers:

```sh
npx dev-annotate serve
```

```html
<script type="module" src="http://127.0.0.1:5178/__annotate/overlay.js"></script>
```

Optional, teach your agent about it:

```sh
npx dev-annotate init
```

## Use

- **P** pick an element, **D** draw, **Ctrl/Cmd+Z** undo, **Ctrl+Shift+D** hide the bar.
- **Send** saves `.annotate/latest.json` and screenshots and copies a short prompt. **Copy** copies the full prompt instead.
- `npx dev-annotate clean` removes the saved files (`--all` includes history).

## Security

The server only answers loopback hosts and origins, accepts PNG images only, limits requests to 25 MB and writes only into `.annotate/`. Use `annotate({ allowedHosts: ["myapp.test"] })` for a custom dev domain.

## License

MIT
