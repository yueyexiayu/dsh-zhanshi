// Isolated real React/Chrome smoke; no server, real Host, credentials or external requests.
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
for (const key of ["DSH_PLAYWRIGHT_MODULE", "DSH_REACT_UMD", "DSH_REACT_DOM_UMD", "DSH_BROWSER_EXECUTABLE"]) {
  if (!process.env[key]) throw new Error(`Set ${key} to an existing read-only local test dependency.`);
}
const { chromium } = await import(pathToFileURL(process.env.DSH_PLAYWRIGHT_MODULE));
const browser = await chromium.launch({ headless: true, executablePath: process.env.DSH_BROWSER_EXECUTABLE });
try {
  const page = await browser.newPage(); const errors = [], calls = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    assert.equal(url.host, "fixture.invalid", "external request forbidden"); calls.push([req.method(), url.pathname]);
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    if (url.pathname === "/api/zhanshi/file") return route.fulfill({ status: 413, headers: { "X-Zhanshi-Preview": "open-file", "X-Zhanshi-File-Size": String(256 * 1048576) }, body: "Saved file is larger than preview limit" });
    if (url.pathname === "/api/file") return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
    throw new Error("unexpected fixture URL: " + url.pathname);
  });
  await page.goto("http://fixture.invalid/");
  await page.addScriptTag({ path: process.env.DSH_REACT_UMD });
  await page.addScriptTag({ path: process.env.DSH_REACT_DOM_UMD });
  await page.evaluate(() => {
    window.opened = [];
    window.__ModuleLoader__ = { load(bundle) { bundle.factory(() => React).apply({
      uiConversation: { events: { register(definition) { window.definition = definition; } } },
      slots: { inject(_name, callback) { callback(); }, register(_options, Gallery) { window.Gallery = Gallery; } },
    }); } };
    window.root = ReactDOM.createRoot(document.getElementById("root"));
  });
  await page.addScriptTag({ path: fileURLToPath(new URL("../lib/client.js", import.meta.url)) });
  const render = async data => page.evaluate(data => root.render(React.createElement(Gallery, { cwd: "/tmp/fixture", seq: 20, turn: { data }, openFile: path => opened.push(path) })), data);
  await render({ zhanshi: { items: [{ path: "old.png", kind: "image", source: "read_image", seq: 2 }] } });
  await page.waitForFunction(() => !document.querySelector(".zs-gallery"));
  await render({ zhanshi: { items: [{ path: "output.png", kind: "image", source: "shengcheng", seq: 3 }, { path: "independent.png", kind: "image", source: "shengcheng", seq: 4 }] }, deliverables: { presented: [{ path: "/tmp/fixture/output.png", seq: 5 }] } });
  await page.waitForSelector('figure[data-path="/tmp/fixture/independent.png"] img');
  assert.equal(await page.locator("figure").count(), 1);
  await page.locator(".zs-hit").click(); assert.deepEqual(await page.evaluate(() => opened), ["/tmp/fixture/independent.png"]);
  await render({ zhanshi: { items: [{ path: "large.mp4", kind: "video", source: "shengcheng", seq: 6 }] } });
  await page.getByText(/256 MiB.*64 MiB/).waitFor(); assert.equal(await page.locator("video").count(), 0);
  await page.getByRole("button", { name: "打开文件", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => opened), ["/tmp/fixture/independent.png", "/tmp/fixture/large.mp4"]);
  assert.ok(calls.some(([method, pathname]) => method === "HEAD" && pathname === "/api/zhanshi/file"));
  assert.deepEqual(errors, []);
  await page.evaluate(() => root.unmount());
  console.log("Real Chrome + React18 isolated Client smoke passed: read-image exclusion, official-present dedup, independent image/open, 256MiB HEAD downgrade/open, unmount; no page errors.");
} finally { await browser.close(); }
