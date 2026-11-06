// dev-annotate overlay: a floating bar to pick elements, pin notes, draw on the
// page and hand it all to a coding agent. Framework-agnostic, no dependencies,
// styles isolated in a shadow root. Loaded by the Vite plugin or `dev-annotate serve`.

const BASE = new URL(import.meta.url).origin;
const STORE = "dev-annotate:" + location.origin;
const COLORS = ["#ff2d55", "#ff9500", "#34c759", "#0a84ff", "#111111"];
const COLOR_NAMES = {
  "#ff2d55": "red",
  "#ff9500": "orange",
  "#34c759": "green",
  "#0a84ff": "blue",
  "#111111": "black",
};
const CHIPS = ["Fix spacing", "Match Figma", "Wrong color", "Make responsive", "Align these", "Remove this", "Animate"];
const TOOLS = { pen: "freehand mark", rect: "rectangle", arrow: "arrow" };

function boot() {
  const state = {
    mode: "off",
    tool: "pen",
    color: COLORS[0],
    items: [],
    redo: [],
    task: "",
    shot: true,
    collapsed: false,
    hidden: false,
    pos: null,
    editing: null,
    seq: 1,
    canSave: false,
    status: "",
  };
  load();

  // ── DOM ────────────────────────────────────────────────────────────────
  const host = document.createElement("div");
  host.id = "dev-annotate";
  host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(h("style", {}, STYLES));
  const canvas = h("canvas", { class: "canvas" });
  const hover = h("div", { class: "hover", hidden: true });
  const pinLayer = h("div", { class: "pins" });
  const editor = h("div", { class: "editor", hidden: true });
  const bar = h("div", { class: "bar" });
  shadow.append(canvas, hover, pinLayer, editor, bar);
  document.documentElement.append(host);

  const ctx = canvas.getContext("2d");
  const routeKey = () => location.pathname + location.search;
  let route = routeKey();
  let drawing = null;

  fetch(BASE + "/__annotate/ping")
    .then(
      (r) => (state.canSave = r.ok),
      () => {},
    )
    .finally(renderBar);

  // ── persistence ────────────────────────────────────────────────────────
  function load() {
    try {
      Object.assign(state, JSON.parse(sessionStorage.getItem(STORE) || "{}"));
      state.seq = Math.max(0, ...state.items.map((i) => i.id)) + 1;
    } catch {
      /* storage may be unavailable */
    }
  }
  function save() {
    try {
      const { items, task, shot, collapsed, hidden, pos, tool, color } = state;
      sessionStorage.setItem(STORE, JSON.stringify({ items, task, shot, collapsed, hidden, pos, tool, color }));
    } catch {
      /* ignore */
    }
  }
  const here = () => state.items.filter((i) => i.route === route);
  const flash = (msg) => {
    state.status = msg;
    renderBar();
    setTimeout(() => {
      if (state.status === msg) {
        state.status = "";
        renderBar();
      }
    }, 3000);
  };

  // ── mode switching ─────────────────────────────────────────────────────
  let raf = 0;
  const onMove = (e) => {
    if (e.target === host) return void (hover.hidden = true);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const r = e.target.getBoundingClientRect();
      hover.hidden = false;
      Object.assign(hover.style, {
        left: r.left + "px",
        top: r.top + "px",
        width: r.width + "px",
        height: r.height + "px",
      });
      hover.dataset.label = `${selectorOf(e.target)} · ${Math.round(r.width)}×${Math.round(r.height)}`;
    });
  };
  const onClick = (e) => {
    if (e.target === host) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target,
      r = el.getBoundingClientRect();
    const pin = {
      id: state.seq++,
      kind: "pin",
      route,
      note: "",
      x: e.pageX,
      y: e.pageY,
      selector: selectorOf(el),
      source: sourceOf(el),
      text: textOf(el),
      size: `${Math.round(r.width)}×${Math.round(r.height)}`,
      styles: stylesOf(el),
    };
    state.items.push(pin);
    state.redo = [];
    hover.hidden = true;
    openEditor(pin);
  };
  function setMode(next) {
    state.mode = state.mode === next ? "off" : next;
    hover.hidden = true;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.documentElement.classList.toggle("dev-annotate-picking", state.mode === "pick");
    if (state.mode === "pick") {
      closeEditor();
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("click", onClick, true);
    }
    canvas.classList.toggle("canvas--on", state.mode === "draw");
    renderBar();
  }
  const style = document.createElement("style");
  style.textContent = "html.dev-annotate-picking, html.dev-annotate-picking * { cursor: crosshair !important; }";
  document.head.append(style);

  // ── element description ────────────────────────────────────────────────
  function selectorOf(el) {
    const parts = [];
    for (
      let cur = el;
      cur && cur !== document.body && cur !== document.documentElement && parts.length < 4;
      cur = cur.parentElement
    ) {
      if (cur.id && !/\d{4,}/.test(cur.id)) {
        parts.unshift("#" + CSS.escape(cur.id));
        break;
      }
      const cls = [...cur.classList]
        .filter((c) => !/^(v-|dev-annotate)/.test(c) && !/\d{4,}/.test(c))
        .slice(0, 2)
        .map((c) => "." + CSS.escape(c))
        .join("");
      let part = cur.tagName.toLowerCase() + cls;
      if (!cls && cur.parentElement) {
        const same = [...cur.parentElement.children].filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(" > ") || el.tagName.toLowerCase();
  }
  // Best-effort source file / component name: Vue, React, Svelte, Astro.
  function sourceOf(el) {
    for (let cur = el; cur; cur = cur.parentElement) {
      const vue = cur.__vueParentComponent?.type;
      if (vue?.__file) return vue.__file.replace(/^.*?\/((?:src|app|pages|components)\/)/, "$1");
      const svelte = cur.__svelte_meta?.loc;
      if (svelte?.file) return `${svelte.file}:${svelte.line}`;
      const astro = cur.getAttribute?.("data-astro-source-file");
      if (astro) return astro;
      const key = Object.keys(cur).find((k) => k.startsWith("__reactFiber$"));
      if (key) {
        for (let f = cur[key]; f; f = f.return) {
          if (f._debugSource?.fileName) return `${f._debugSource.fileName}:${f._debugSource.lineNumber}`;
          if (typeof f.type === "function" && (f.type.displayName || f.type.name))
            return `<${f.type.displayName || f.type.name}> component`;
        }
      }
    }
    return "";
  }
  const textOf = (el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
  function stylesOf(el) {
    const s = getComputedStyle(el),
      out = [];
    const add = (k, v, skip) => {
      if (v && v !== skip) out.push(`${k}: ${v}`);
    };
    add("display", s.display);
    add("color", s.color);
    add("background", s.backgroundColor, "rgba(0, 0, 0, 0)");
    add("font", `${s.fontSize}/${s.lineHeight} ${s.fontWeight}`);
    add("padding", s.padding, "0px");
    add("margin", s.margin, "0px");
    add("border", s.borderTopWidth === "0px" ? "" : `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`);
    add("radius", s.borderRadius, "0px");
    add("gap", s.gap, "normal");
    return out.join("; ");
  }
  function targetAt(x, y) {
    const el = document.elementsFromPoint(x, y).find((e) => e !== host);
    return el ? { selector: selectorOf(el), source: sourceOf(el) } : null;
  }

  // ── pins + editor ──────────────────────────────────────────────────────
  function anchor(item) {
    if (item.kind === "pin") return [item.x, item.y];
    const last = item.pts[item.pts.length - 1];
    return last;
  }
  function renderPins() {
    pinLayer.replaceChildren(
      ...here()
        .filter((i) => i.kind === "pin")
        .map((p) =>
          h(
            "button",
            {
              class: "pin" + (state.editing === p ? " pin--on" : ""),
              style: { left: p.x + "px", top: p.y + "px" },
              title: p.note || "(no note)",
              onclick: (e) => {
                e.stopPropagation();
                openEditor(p);
              },
            },
            String(p.id),
          ),
        ),
    );
    // shape badges
    for (const s of here().filter((i) => i.kind === "shape")) {
      const [x, y] = s.pts[0];
      pinLayer.append(
        h(
          "button",
          {
            class: "pin pin--shape" + (state.editing === s ? " pin--on" : ""),
            style: { left: x + "px", top: y + "px", background: s.color },
            title: s.note || "(no note)",
            onclick: (e) => {
              e.stopPropagation();
              openEditor(s);
            },
          },
          String(s.id),
        ),
      );
    }
  }
  function openEditor(item) {
    closeEditor(true);
    state.editing = item;
    const [ax, ay] = anchor(item);
    const left = Math.min(Math.max(ax, scrollX + 8), scrollX + innerWidth - 308);
    const below = ay - scrollY < innerHeight - 240;
    const area = h("textarea", {
      rows: 3,
      placeholder: item.kind === "pin" ? "What should change here?" : "Note (optional): what does this mark mean?",
      value: item.note,
      oninput: () => {
        item.note = area.value;
        save();
        renderCount();
      },
      onkeydown: (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          closeEditor();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          closeEditor();
        }
      },
    });
    const meta =
      item.kind === "pin"
        ? `#${item.id} · ${item.selector}${item.source ? " · " + item.source : ""}`
        : `#${item.id} · ${TOOLS[item.tool]}${item.target ? " on " + item.target.selector : ""}`;
    editor.replaceChildren(
      h("div", { class: "editor__meta" }, meta),
      area,
      h(
        "div",
        { class: "chips" },
        CHIPS.map((c) =>
          h(
            "button",
            {
              class: "chip",
              onclick: () => {
                area.value = (area.value ? area.value.replace(/\.?\s*$/, ". ") : "") + c;
                item.note = area.value;
                save();
                area.focus();
              },
            },
            c,
          ),
        ),
      ),
      h(
        "div",
        { class: "row row--between" },
        h("button", { class: "btn", onclick: () => remove(item) }, "Delete"),
        h("button", { class: "btn btn--primary", onclick: () => closeEditor() }, "Done ↵"),
      ),
    );
    Object.assign(editor.style, { left: left + "px", top: (below ? ay + 18 : ay - 210) + "px" });
    editor.hidden = false;
    renderPins();
    setTimeout(() => area.focus(), 0);
  }
  function closeEditor(keep) {
    const it = state.editing;
    editor.hidden = true;
    state.editing = null;
    // A pin without a note is noise; a drawing stands on its own.
    if (it && it.kind === "pin" && !it.note.trim()) state.items = state.items.filter((i) => i !== it);
    if (!keep) {
      renderPins();
      renderBar();
      redraw();
      save();
    }
  }
  function remove(item) {
    state.items = state.items.filter((i) => i !== item);
    state.editing = null;
    editor.hidden = true;
    renderPins();
    renderBar();
    redraw();
    save();
  }

  // ── drawing ────────────────────────────────────────────────────────────
  function resize() {
    const dpr = devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    Object.assign(canvas.style, { width: innerWidth + "px", height: innerHeight + "px" });
    redraw();
  }
  function paint(s) {
    const pts = s.pts.map(([x, y]) => [x - scrollX, y - scrollY]);
    ctx.strokeStyle = ctx.fillStyle = s.color;
    ctx.lineWidth = 3;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    if (s.tool === "pen") {
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      return;
    }
    const a = pts[0],
      b = pts[pts.length - 1];
    if (s.tool === "rect") {
      ctx.roundRect(a[0], a[1], b[0] - a[0], b[1] - a[1], 4);
      ctx.stroke();
      return;
    }
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.stroke();
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    ctx.beginPath();
    ctx.moveTo(...b);
    for (const d of [Math.PI * 0.85, -Math.PI * 0.85])
      ctx.lineTo(b[0] + 16 * Math.cos(ang + d), b[1] + 16 * Math.sin(ang + d));
    ctx.closePath();
    ctx.fill();
  }
  function redraw() {
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const s of here().filter((i) => i.kind === "shape")) paint(s);
    if (drawing) paint(drawing);
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (state.mode !== "draw") return;
    canvas.setPointerCapture(e.pointerId);
    drawing = {
      id: 0,
      kind: "shape",
      route,
      tool: state.tool,
      color: state.color,
      note: "",
      pts: [[e.pageX, e.pageY]],
      target: null,
    };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    if (drawing.tool === "pen") drawing.pts.push([e.pageX, e.pageY]);
    else drawing.pts = [drawing.pts[0], [e.pageX, e.pageY]];
    redraw();
  });
  canvas.addEventListener("pointerup", () => {
    if (!drawing) return;
    const s = drawing;
    drawing = null;
    const xs = s.pts.map((p) => p[0]),
      ys = s.pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs),
      hgt = Math.max(...ys) - Math.min(...ys);
    if (w < 6 && hgt < 6) return redraw();
    s.id = state.seq++;
    s.target = targetAt(
      (Math.min(...xs) + Math.max(...xs)) / 2 - scrollX,
      (Math.min(...ys) + Math.max(...ys)) / 2 - scrollY,
    );
    state.items.push(s);
    state.redo = [];
    save();
    renderBar();
    renderPins();
    redraw();
    openEditor(s);
  });

  // ── undo / redo / clear ────────────────────────────────────────────────
  function undo() {
    const last = [...here()].pop();
    if (!last) return;
    state.items = state.items.filter((i) => i !== last);
    state.redo.push(last);
    closeEditor();
  }
  function redo() {
    const it = state.redo.pop();
    if (it) {
      state.items.push(it);
      closeEditor();
    }
  }
  function clearAll() {
    if (state.items.length && !confirm("Remove all pins and drawings?")) return;
    state.items = [];
    state.redo = [];
    closeEditor();
  }

  // ── prompt / payload ───────────────────────────────────────────────────
  const flags = () =>
    [...document.documentElement.classList]
      .filter((c) => !c.startsWith("dev-annotate"))
      .slice(0, 6)
      .join(", ");
  function describe(it) {
    const L = [];
    if (it.kind === "pin") {
      L.push(
        `- [${it.id}] ${it.note}`,
        `    element: \`${it.selector}\` (${it.size})${it.text ? ` text "${it.text}"` : ""}`,
      );
      if (it.source) L.push(`    source: ${it.source}`);
      if (it.styles) L.push(`    computed: ${it.styles}`);
      L.push(`    pin at page (${Math.round(it.x)}, ${Math.round(it.y)})`);
    } else {
      L.push(
        `- [${it.id}] Drawn ${COLOR_NAMES[it.color] || it.color} ${TOOLS[it.tool]}${it.target ? ` on \`${it.target.selector}\`` : ""}${it.note ? `: ${it.note}` : ""}`,
      );
      if (it.target?.source) L.push(`    source: ${it.target.source}`);
    }
    return L;
  }
  function buildPrompt(shotCount) {
    const L = [state.task.trim() || "Please make the following changes to the page."];
    L.push(
      "",
      `Page: ${location.pathname}${location.search} · viewport ${innerWidth}×${innerHeight}${flags() ? " · html classes: " + flags() : ""}`,
    );
    if (shotCount)
      L.push(
        `${shotCount} screenshot${shotCount > 1 ? "s" : ""} with my annotations are listed in latest.json under "screenshots" (read them all)`,
      );
    for (const r of [...new Set(state.items.map((i) => i.route))])
      L.push("", `## ${r}`, ...state.items.filter((i) => i.route === r).flatMap(describe));
    return L.join("\n");
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      console.log(text);
      return false;
    }
  }
  async function copyPrompt() {
    flash((await copyText(buildPrompt())) ? "Prompt copied" : "Clipboard blocked: see console");
  }

  // Captures this tab (the browser asks for permission) with the bar hidden.
  // Which scroll positions are needed so every annotation on this page is in some frame.
  function framePlan() {
    const H = innerHeight,
      room = H - 160,
      MAX = 8;
    const spans = here()
      .map((i) => {
        const ys = i.kind === "pin" ? [i.y - 14, i.y + 14] : i.pts.map((p) => p[1]);
        return { id: i.id, top: Math.min(...ys), bottom: Math.max(...ys) };
      })
      .sort((p, q) => p.top - q.top);
    const frames = [];
    for (const sp of spans) {
      const f = frames[frames.length - 1];
      if (f && sp.bottom <= f.start + room + 80 && frames.length) f.ids.push(sp.id);
      else if (frames.length >= MAX) frames[frames.length - 1].ids.push(sp.id);
      else frames.push({ start: Math.max(0, Math.round(sp.top - 80)), ids: [sp.id] });
    }
    return frames.length ? frames : [{ start: scrollY, ids: [] }];
  }
  // One frame per group of annotations: the tab is captured once (one permission
  // prompt), the page scrolls to each group, and the original scroll comes back.
  async function capture() {
    host.classList.add("capturing");
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const origin = { x: scrollX, y: scrollY };
    let stream;
    try {
      await wait(120);
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true });
      const v = document.createElement("video");
      v.srcObject = stream;
      v.muted = true;
      await v.play();
      const shots = [];
      for (const f of framePlan()) {
        scrollTo({ left: origin.x, top: f.start, behavior: "instant" });
        await wait(400);
        const scale = Math.min(1, 1800 / v.videoWidth),
          c = document.createElement("canvas");
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        shots.push({ png: c.toDataURL("image/png"), scrollY: Math.round(scrollY), items: f.ids });
      }
      return shots;
    } catch {
      return [];
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      scrollTo({ left: origin.x, top: origin.y, behavior: "instant" });
      host.classList.remove("capturing");
    }
  }
  async function send() {
    let shots = [];
    if (state.shot) {
      shots = await capture();
      if (!shots.length) flash("Screenshot skipped");
    }
    const payload = {
      version: 2,
      createdAt: new Date().toISOString(),
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollX, scrollY },
      task: state.task,
      items: state.items,
      // `file` is filled in by the server; `items` are the annotation ids visible in that frame.
      screenshots: shots.map((s) => ({ scrollY: s.scrollY, items: s.items })),
      prompt: buildPrompt(shots.length),
    };
    try {
      const res = await fetch(BASE + "/__annotate/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: payload, pngs: shots.map((s) => s.png) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { json, pngs, dir } = await res.json();
      const short = `Apply my UI annotations: read ${json}${pngs.length ? ` and the ${pngs.length} screenshot${pngs.length > 1 ? "s" : ""} it lists` : ""}.${state.task.trim() ? " " + state.task.trim() : ""}`;
      flash((await copyText(short)) ? `Saved to ${dir}/ · paste into your agent` : "Saved · clipboard blocked");
    } catch {
      flash("Save failed: is the dev-annotate server running?");
    }
  }

  // ── bar ────────────────────────────────────────────────────────────────
  const ICON = {
    pick: '<path d="M3 2l10 4.5-4.2 1.6L7 12.5z"/>',
    draw: '<path d="M2 14l1-3.5L11.5 2l2.5 2.5L5.5 13z"/>',
    pen: '<path d="M2 11c2-6 4-6 5-2s3 3 5-3"/>',
    rect: '<rect x="2.5" y="4" width="11" height="8" rx="1.5"/>',
    arrow: '<path d="M3 13L13 3M7 3h6v6"/>',
    undo: '<path d="M6 3L2.5 6.5 6 10M3 6.5h6a4 4 0 010 8H6"/>',
    redo: '<path d="M10 3l3.5 3.5L10 10M13 6.5H7a4 4 0 000 8h3"/>',
    copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10V3.5A1.5 1.5 0 014.5 2H10"/>',
    send: '<path d="M2 8l12-5-4 11-2.5-4.5z"/>',
    trash: '<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
    cam: '<path d="M2 5h2.5L6 3h4l1.5 2H14v8H2z"/><circle cx="8" cy="9" r="2.2"/>',
    min: '<path d="M3 8h10"/>',
    grip: '<path d="M6 3v.01M10 3v.01M6 8v.01M10 8v.01M6 13v.01M10 13v.01" stroke-width="2.4"/>',
  };
  const icon = (n) =>
    h("span", {
      class: "icon",
      html: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`,
    });
  const btn = (label, ic, onclick, opts = {}) =>
    h(
      "button",
      {
        class:
          "btn" + (opts.on ? " btn--on" : "") + (opts.primary ? " btn--primary" : "") + (!label ? " btn--icon" : ""),
        title: opts.title || label,
        disabled: opts.disabled,
        "data-need": opts.need,
        onclick,
      },
      ic && icon(ic),
      label,
    );
  function syncDisabled() {
    const none = !state.items.length && !state.task.trim();
    for (const b of bar.querySelectorAll("[data-need]"))
      b.disabled = none || (b.dataset.need === "send" && !state.canSave);
  }
  function renderCount() {
    const n = state.items.length;
    const el = bar.querySelector(".count");
    if (el) el.textContent = String(n);
    syncDisabled();
    save();
  }
  function renderBar() {
    host.style.display = state.hidden ? "none" : "";
    const n = state.items.length,
      none = !n && !state.task.trim();
    const grip = h("span", { class: "grip", title: "Drag", onpointerdown: dragStart }, icon("grip"));
    const toggle = btn(
      state.collapsed ? `Annotate · ${n}` : "",
      state.collapsed ? null : "min",
      () => {
        state.collapsed = !state.collapsed;
        save();
        renderBar();
      },
      { title: state.collapsed ? "Expand" : "Collapse (Ctrl+Shift+D hides)" },
    );
    if (state.collapsed) bar.replaceChildren(h("div", { class: "row" }, grip, toggle));
    else
      bar.replaceChildren(
        h(
          "div",
          { class: "row" },
          grip,
          btn("Pick", "pick", () => setMode("pick"), { on: state.mode === "pick", title: "Pick an element (P)" }),
          btn("Draw", "draw", () => setMode("draw"), { on: state.mode === "draw", title: "Draw on the page (D)" }),
          state.mode === "draw" &&
            h(
              "span",
              { class: "group" },
              ...Object.keys(TOOLS).map((t, i) =>
                btn(
                  "",
                  t,
                  () => {
                    state.tool = t;
                    save();
                    renderBar();
                  },
                  { on: state.tool === t, title: `${TOOLS[t]} (${i + 1})` },
                ),
              ),
              ...COLORS.map((c) =>
                h("button", {
                  class: "swatch" + (state.color === c ? " swatch--on" : ""),
                  style: { background: c },
                  title: COLOR_NAMES[c],
                  onclick: () => {
                    state.color = c;
                    save();
                    renderBar();
                  },
                }),
              ),
            ),
          h("span", { class: "sep" }),
          btn("", "undo", undo, { title: "Undo (Ctrl+Z)", disabled: !here().length }),
          btn("", "redo", redo, { title: "Redo (Ctrl+Shift+Z)", disabled: !state.redo.length }),
          btn("", "trash", clearAll, { title: "Clear everything", disabled: !n }),
          h("span", { class: "count", title: "Annotations" }, String(n)),
          h("span", { class: "sep" }),
          btn("Copy", "copy", copyPrompt, { title: "Copy the full prompt", disabled: none, need: "copy" }),
          btn("Send", "send", send, {
            primary: true,
            title: state.canSave
              ? "Save to .annotate/ and copy a short prompt for your agent"
              : "Needs the dev-annotate server (see README)",
            disabled: none || !state.canSave,
            need: "send",
          }),
          h(
            "label",
            { class: "shot", title: "Also capture a screenshot (the browser asks once)" },
            h("input", {
              type: "checkbox",
              checked: state.shot,
              onchange: (e) => {
                state.shot = e.target.checked;
                save();
              },
            }),
            icon("cam"),
          ),
          toggle,
        ),
        h("input", {
          class: "task",
          placeholder: "What should the agent do? (goes first in the prompt)",
          value: state.task,
          oninput: (e) => {
            state.task = e.target.value;
            save();
            syncDisabled();
          },
        }),
        state.status && h("div", { class: "status" }, state.status),
      );
    Object.assign(
      bar.style,
      state.pos ? { left: state.pos.x + "px", top: state.pos.y + "px", bottom: "auto", transform: "none" } : {},
    );
  }
  function dragStart(e) {
    e.preventDefault();
    const r = bar.getBoundingClientRect(),
      ox = e.clientX - r.left,
      oy = e.clientY - r.top;
    const mv = (ev) => {
      state.pos = {
        x: Math.min(Math.max(0, ev.clientX - ox), innerWidth - 80),
        y: Math.min(Math.max(0, ev.clientY - oy), innerHeight - 40),
      };
      Object.assign(bar.style, {
        left: state.pos.x + "px",
        top: state.pos.y + "px",
        bottom: "auto",
        transform: "none",
      });
    };
    const end = () => {
      removeEventListener("pointermove", mv);
      removeEventListener("pointerup", end);
      save();
    };
    addEventListener("pointermove", mv);
    addEventListener("pointerup", end);
  }

  // ── global wiring ──────────────────────────────────────────────────────
  const typing = () => {
    const a = shadow.activeElement || document.activeElement;
    return a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
  };
  addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.ctrlKey && e.shiftKey && e.code === "KeyD") {
      state.hidden = !state.hidden;
      if (state.hidden) setMode("off");
      save();
      renderBar();
      return;
    }
    if (state.hidden) return;
    if (e.key === "Escape") {
      if (state.editing) closeEditor();
      else if (state.mode !== "off") setMode("off");
      return;
    }
    if (typing()) return;
    if (mod && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod || e.altKey) return;
    if (e.code === "KeyP") setMode("pick");
    else if (e.code === "KeyD") setMode("draw");
    else if (state.mode === "draw" && ["Digit1", "Digit2", "Digit3"].includes(e.code)) {
      state.tool = Object.keys(TOOLS)[+e.code.slice(-1) - 1];
      save();
      renderBar();
    }
  });
  addEventListener("scroll", redraw, { passive: true });
  addEventListener("resize", resize);
  setInterval(() => {
    if (routeKey() !== route) {
      route = routeKey();
      closeEditor();
      renderPins();
      renderBar();
      redraw();
    }
  }, 400);
  resize();
  renderPins();
  renderBar();
  redraw();
}

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") Object.assign(el.style, v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "value" || k === "checked" || k === "disabled" || k === "hidden") el[k] = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat())
    if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font: 12px/1.3 ui-sans-serif, system-ui, -apple-system, sans-serif; }
[hidden] { display: none !important; }
:host(.capturing) .bar, :host(.capturing) .editor, :host(.capturing) .hover { display: none !important; }
.bar { position: fixed; z-index: 3; bottom: 16px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 16px); padding: 8px; display: grid; gap: 6px; background: #15171c; color: #fff; border-radius: 14px; box-shadow: 0 8px 32px rgb(0 0 0 / 38%), 0 0 0 1px rgb(255 255 255 / 8%); }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.row--between { justify-content: space-between; }
.group { display: inline-flex; align-items: center; gap: 4px; padding-left: 6px; }
.sep { width: 1px; align-self: stretch; margin: 2px 4px; background: rgb(255 255 255 / 14%); }
.grip { cursor: grab; opacity: .55; padding: 0 2px; display: inline-flex; touch-action: none; }
.icon { display: inline-flex; width: 16px; height: 16px; }
.icon svg { width: 16px; height: 16px; }
.btn { appearance: none; border: 0; border-radius: 8px; padding: 6px 9px; display: inline-flex; align-items: center; gap: 6px; background: #2a2d35; color: #fff; cursor: pointer; transition: background 120ms; }
.btn--icon { padding: 6px; }
.btn:hover:not(:disabled) { background: #3a3e48; }
.btn:disabled { opacity: .35; cursor: default; }
.btn--on, .btn--primary { background: #0a84ff; }
.btn--on:hover:not(:disabled), .btn--primary:hover:not(:disabled) { background: #3b9dff; }
.btn:focus-visible, .chip:focus-visible, .swatch:focus-visible, .pin:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.swatch { width: 18px; height: 18px; border-radius: 50%; border: 2px solid transparent; padding: 0; cursor: pointer; }
.swatch--on { border-color: #fff; }
.count { min-width: 20px; padding: 2px 6px; border-radius: 999px; background: #2a2d35; text-align: center; font-weight: 600; }
.shot { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; cursor: pointer; opacity: .9; }
.shot input { margin: 0; accent-color: #0a84ff; }
.task, textarea { width: 100%; border: 1px solid #3a3e48; border-radius: 8px; background: #0e1014; color: #fff; padding: 7px 9px; resize: vertical; outline: none; }
.task:focus, textarea:focus { border-color: #0a84ff; }
.status { color: #7dd3a0; padding: 0 2px; }
.canvas { position: fixed; inset: 0; z-index: 1; pointer-events: none; }
.canvas--on { pointer-events: auto; cursor: crosshair; }
.hover { position: fixed; z-index: 1; pointer-events: none; outline: 2px solid #0a84ff; background: rgb(10 132 255 / 12%); }
.hover::before { content: attr(data-label); position: absolute; left: 0; top: -22px; padding: 2px 6px; border-radius: 4px; background: #0a84ff; color: #fff; font: 11px ui-monospace, SFMono-Regular, monospace; white-space: nowrap; max-width: 80vw; overflow: hidden; text-overflow: ellipsis; }
.pin { position: absolute; z-index: 2; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%; border: 2px solid #fff; background: #ff2d55; color: #fff; font-weight: 700; cursor: pointer; padding: 0; box-shadow: 0 2px 8px rgb(0 0 0 / 35%); transition: transform 120ms; }
.pin:hover, .pin--on { transform: scale(1.18); }
.pin--shape { width: 20px; height: 20px; margin: -10px 0 0 -10px; font-size: 11px; }
.editor { position: absolute; z-index: 4; width: 300px; padding: 10px; display: grid; gap: 8px; background: #15171c; color: #fff; border-radius: 12px; box-shadow: 0 8px 32px rgb(0 0 0 / 38%), 0 0 0 1px rgb(255 255 255 / 8%); }
.editor__meta { font: 10px ui-monospace, SFMono-Regular, monospace; opacity: .6; overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { appearance: none; border: 1px solid #3a3e48; border-radius: 999px; background: none; color: #cfd3dc; padding: 2px 8px; cursor: pointer; font-size: 11px; }
.chip:hover { background: #2a2d35; }
@media (prefers-reduced-motion: reduce) { .pin, .btn { transition: none; } }
`;

if (!window.__devAnnotate) {
  window.__devAnnotate = true;
  boot();
}
