---
name: annotate
description: Apply UI feedback a developer marked up in the browser with the dev-annotate bar. Use when the user mentions .annotate/latest.json or its screenshots, says "see my annotations", "the marked elements", "what I circled/drew", or pastes a prompt with numbered pins, selectors and a screenshot path.
---

# Annotated UI feedback

The developer used the dev-annotate bar in their running app to pick elements, pin notes and draw on the page.
The result is in `.annotate/` (git-ignored):

- `latest.json`: the task, every annotation (numbered), the page URL and viewport.
- `latest-shot-N.png`: screenshots of the page with the pins and drawings on top, one per scroll position. `screenshots` in the JSON lists each file, its `scrollY` and the annotation ids visible in it (may be empty).

## How to work

1. Read `.annotate/latest.json`, then look at every screenshot listed under `screenshots`. They show what the pins and drawings point at; the JSON gives the exact elements.
2. Each item is numbered. **Pins** have a note, a CSS `selector`, the visible `text`, the `size`, the computed styles and (when detectable) the `source` file or component. **Drawings** (pen, rectangle, arrow) mark an area; `target` is the element under the drawing and `note` is optional. A rectangle or circle means "this thing", an arrow means "this should move/point there", a scribble over something means "remove or fix".
3. Find the code: start from `source`, otherwise search for the selector's class names or the visible text. Do not edit by selector alone. Change the real component or stylesheet.
4. Make only the requested changes. If an item is ambiguous (for example a drawing without a note that could mean two things), say what you assumed instead of guessing silently.
5. Follow the project's own conventions (design tokens, naming, tests). Do not commit `.annotate/`.
6. End with a short list: item number, what you changed, file. Mention anything you skipped and why.
7. Clean up once every item is applied (or deliberately skipped) and you have nothing left to ask: delete `.annotate/latest.json` and `.annotate/latest-shot-*.png`. Keep them if you are waiting for an answer, so the next turn can still read them. The dated history files stay; the bar prunes them itself.

The `task` field is the developer's overall instruction and wins over a conflicting default.
