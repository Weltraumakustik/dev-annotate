import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createHandler } from "../server.mjs";

let server, base, dir;
const PNG = "data:image/png;base64," + Buffer.from("png").toString("base64");

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "annotate-"));
  const handler = createHandler({ dir, cwd: dir });
  server = createServer((req, res) =>
    handler(req, res, () => {
      res.statusCode = 404;
      res.end("next");
    }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (body, headers = {}) =>
  fetch(base + "/__annotate/save", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("passes other routes through", async () => assert.equal(await (await fetch(base + "/x")).text(), "next"));
test("serves the overlay and a ping", async () => {
  assert.match(await (await fetch(base + "/__annotate/overlay.js")).text(), /dev-annotate overlay/);
  assert.equal((await fetch(base + "/__annotate/ping")).status, 200);
});
test("rejects foreign origins and hosts", async () => {
  assert.equal((await post({ json: {} }, { Origin: "https://evil.example" })).status, 403);
  const status = await new Promise((resolve) =>
    request(base + "/__annotate/ping", { headers: { Host: "evil.example" } }, (r) => {
      r.resume();
      resolve(r.statusCode);
    }).end(),
  );
  assert.equal(status, 403);
});
test("saves json + png and a self-ignoring folder", async () => {
  const res = await post(
    { json: { task: "t", screenshots: [{ scrollY: 5, items: [1] }] }, pngs: [PNG, PNG] },
    { Origin: "http://localhost:5173" },
  );
  const out = await res.json();
  assert.equal(res.status, 200);
  assert.equal(out.pngs.length, 2);
  const saved = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
  assert.equal(saved.screenshots[0].scrollY, 5);
  assert.match(saved.screenshots[1].file, /latest-shot-2\.png$/);
  assert.equal(JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")).task, "t");
  assert.ok(existsSync(join(dir, "latest-shot-1.png")));
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "*\n");
});
test("removes a stale screenshot when none is sent", async () => {
  await post({ json: { task: "no shot" }, pngs: [] });
  assert.equal(existsSync(join(dir, "latest-shot-1.png")), false);
});
test("validates the payload", async () => {
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post({ json: {}, pngs: ["data:text/html;base64,AAAA"] })).status, 400);
});
