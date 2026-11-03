/* Browser/API regression tests. Always creates its own servers and temporary storage. */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const children = [];
let browser;
let temporary;
let page;
const start = (command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  children.push(child);
  child.output = "";
  child.stdout.on("data", (chunk) => {
    child.output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    child.output += chunk;
  });
  return child;
};
const freePort = async () => {
  const server = net.createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};
const waitForServer = async (url, child) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(child.output);
    }
    try {
      if ((await fetch(url)).ok) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not start: ${child.output}`);
};
const test = async (name, run) => {
  await run();
  console.log(`PASS ${name}`);
};
const dialog = (p = page) =>
  p.getByRole("dialog", { name: "Drawings", exact: true });
const openGallery = async (p = page) => {
  await p.getByRole("button", { name: "Drawings", exact: true }).click();
  await dialog(p).waitFor();
};
const closeGallery = async (p = page) => {
  await dialog(p)
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await dialog(p).waitFor({ state: "hidden" });
};
const loadFromGallery = async (name, p = page) => {
  await dialog(p)
    .getByRole("button", { name: `Preview ${name}`, exact: true })
    .click();
  await dialog(p)
    .getByRole("button", { name: `Load ${name}`, exact: true })
    .click();
};
const identity = (p = page) => p.evaluate(() => window.h.state.serverDrawing);
const canvasSnapshot = (p = page) =>
  p.evaluate(() =>
    JSON.stringify(
      window.h.elements
        .filter((element) => !element.isDeleted)
        // Restoration normalizes an absent binding list to an empty array.
        .map((element) => ({
          ...element,
          boundElements: element.boundElements ?? [],
        })),
    ),
  );

const persisted = (p = page) =>
  p.waitForFunction(() => {
    const stored = JSON.parse(sessionStorage.getItem("arabidraw-tab-draft"));
    return (
      stored?.baseDrawing?.revision ===
        window.h.state.serverDrawing?.revision &&
      stored?.baseDrawing?.id === window.h.state.serverDrawing?.id
    );
  });
const draw = async (p = page, x = 550) => {
  await p.keyboard.press("Escape");
  await p.keyboard.press("r");
  await p.mouse.move(x, 350);
  await p.mouse.down();
  await p.mouse.move(x + 120, 460, { steps: 5 });
  await p.mouse.up();
  await p.keyboard.press("Escape");
};

(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "arabidraw-v2-test-"));
  const apiPort = await freePort();
  const uiPort = await freePort();
  const apiURL = `http://127.0.0.1:${apiPort}`;
  const uiURL = `http://127.0.0.1:${uiPort}`;
  const compile = start(process.execPath, [
    "node_modules/typescript/bin/tsc",
    "-p",
    "server/tsconfig.json",
    "--outDir",
    path.join(temporary, "api"),
  ]);
  const [code] = await once(compile, "exit");
  assert.equal(code, 0, compile.output);
  const startAPI = () =>
    start(process.execPath, [path.join(temporary, "api/index.js")], {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(apiPort),
        DRAWINGS_DIR: path.join(temporary, "drawings"),
      },
    });
  let api = startAPI();
  await waitForServer(`${apiURL}/api/drawings`, api);
  const ui = start(
    process.execPath,
    [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(uiPort),
      "--strictPort",
    ],
    {
      cwd: path.join(root, "excalidraw-app"),
      env: {
        ...process.env,
        DRAWINGS_API_URL: apiURL,
        VITE_APP_ENABLE_ESLINT: "false",
        VITE_APP_ENABLE_TRACKING: "false",
      },
    },
  );
  await waitForServer(uiURL, ui);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE_PATH
      ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
    Object.defineProperty(window.crypto, "randomUUID", { value: undefined });
  });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let acceptDialog = true;
  let unloadWarnings = 0;
  const serverWrites = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/drawings") &&
      ["POST", "PUT", "DELETE"].includes(request.method())
    ) {
      serverWrites.push(request.method());
    }
  });
  page.on("dialog", (d) => {
    if (d.type() === "beforeunload") {
      unloadWarnings++;
    }
    return acceptDialog ? d.accept() : d.dismiss();
  });
  await page.goto(uiURL);
  await page.getByRole("button", { name: "Save", exact: true }).waitFor();
  const list = async () => (await fetch(`${apiURL}/api/drawings`)).json();
  const get = async (id) =>
    (await fetch(`${apiURL}/api/drawings/${id}`)).json();
  let original;
  let copy;

  await test("create an Arabic-named drawing through the UI; blank names disabled", async () => {
    await draw();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await dialog().getByLabel("Drawing name", { exact: true }).fill("   ");
    assert.equal(
      await dialog()
        .getByRole("button", { name: "Save", exact: true })
        .isDisabled(),
      true,
    );
    await dialog().getByLabel("Drawing name", { exact: true }).fill("رسم عربي");
    await dialog().getByRole("button", { name: "Save", exact: true }).click();
    await dialog().getByText("Saved to server", { exact: true }).waitFor();
    original = await identity();
    assert.equal(new URL(page.url()).pathname, `/drawing/${original.id}`);
    assert.equal((await list()).length, 1);
    assert.equal((await get(original.id)).scene.elements.length, 1);
    await dialog()
      .getByRole("img", { name: "Preview of رسم عربي", exact: true })
      .waitFor();
    await closeGallery();
  });
  await test("reload preserves identity and clean state", async () => {
    await persisted();
    const warningsBefore = unloadWarnings;
    const writesBefore = serverWrites.length;
    await page.reload();
    await openGallery();
    assert.equal(unloadWarnings, warningsBefore);
    assert.equal(serverWrites.length, writesBefore);
    await dialog().getByText("Saved to server", { exact: true }).waitFor();
    assert.equal((await identity()).id, original.id);
    await closeGallery();
  });
  await test("toolbar and Ctrl+S update the same file; edits survive reload", async () => {
    await draw(page, 800);
    await page.keyboard.press("Control+s");
    await page.waitForFunction(
      (revision) => window.h.state.serverDrawing?.revision !== revision,
      original.revision,
    );
    original = await identity();
    assert.equal((await list()).length, 1);
    assert.equal((await get(original.id)).scene.elements.length, 2);
    await draw(page, 950);
    const serverBefore = await get(original.id);
    const canvasBefore = await canvasSnapshot();
    const writesBefore = serverWrites.length;
    const warningsBefore = unloadWarnings;
    // Cancel once, then reload anyway. Both paths must leave the server alone.
    acceptDialog = false;
    const cancelledReloadDialog = page.waitForEvent("dialog");
    const devtools = await context.newCDPSession(page);
    await devtools.send("Page.reload");
    await cancelledReloadDialog;
    await devtools.detach();
    assert.equal(unloadWarnings, warningsBefore + 1);
    assert.equal(await canvasSnapshot(), canvasBefore);
    acceptDialog = true;
    await page.reload();
    await openGallery();
    await dialog().getByText("Unsaved changes", { exact: true }).waitFor();
    assert.equal(unloadWarnings, warningsBefore + 2);
    assert.equal(serverWrites.length, writesBefore);
    assert.deepEqual(await get(original.id), serverBefore);
    assert.deepEqual(await identity(), original);
    assert.equal(await canvasSnapshot(), canvasBefore);
    assert.equal(new URL(page.url()).pathname, `/drawing/${original.id}`);
    await closeGallery();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(
      (revision) => window.h.state.serverDrawing?.revision !== revision,
      original.revision,
    );
    original = await identity();
    assert.equal((await get(original.id)).scene.elements.length, 3);
  });
  await test("rename updates; Save as copy makes a new file; load remains clean", async () => {
    await openGallery();
    await dialog()
      .getByLabel("Drawing name", { exact: true })
      .fill("Renamed drawing");
    await dialog().getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(
      () => window.h.state.serverDrawing?.name === "Renamed drawing",
    );
    assert.equal((await identity()).id, original.id);
    original = await identity();
    await dialog()
      .getByLabel("Drawing name", { exact: true })
      .fill("Copy drawing");
    await dialog()
      .getByRole("button", { name: "Save as copy", exact: true })
      .click();
    await page.waitForFunction(
      () => window.h.state.serverDrawing?.name === "Copy drawing",
    );
    copy = await identity();
    assert.notEqual(copy.id, original.id);
    assert.equal(new URL(page.url()).pathname, `/drawing/${copy.id}`);
    assert.equal((await list()).length, 2);
    await loadFromGallery("Renamed drawing");
    await dialog().waitFor({ state: "hidden" });
    await openGallery();
    await dialog().getByText("Saved to server", { exact: true }).waitFor();
    await closeGallery();
  });
  await test("copied URLs load in fresh browsers; storage cannot select another drawing", async () => {
    const freshContext = await browser.newContext();
    const fresh = await freshContext.newPage();
    fresh.on("dialog", (d) => d.accept());
    await fresh.goto(page.url());
    await fresh.waitForFunction(
      (id) => window.h?.state.serverDrawing?.id === id,
      original.id,
    );
    assert.equal(await fresh.evaluate(() => window.h.elements.length), 3);
    await persisted(fresh);
    // Navigate directly with the other drawing's draft still in this tab.
    await fresh.goto(`${uiURL}/drawing/${copy.id}`);
    await fresh.waitForFunction(
      (id) => window.h?.state.serverDrawing?.id === id,
      copy.id,
    );
    await persisted(fresh);
    assert.equal(
      await fresh.evaluate(
        () =>
          JSON.parse(localStorage.getItem("excalidraw-state")).serverDrawing,
      ),
      undefined,
    );
    await fresh.goto(uiURL);
    await fresh.getByRole("button", { name: "Save", exact: true }).waitFor();
    assert.equal(await identity(fresh), null);
    assert.equal(await fresh.evaluate(() => window.h.elements.length), 0);
    await freshContext.close();
  });
  await test("Back and Forward load the drawing in the URL; cancelling keeps history usable", async () => {
    // History is original -> copy -> original after the gallery operations above.
    await page.goBack();
    await page.waitForFunction(
      (id) => window.h.state.serverDrawing?.id === id,
      copy.id,
    );
    assert.equal(new URL(page.url()).pathname, `/drawing/${copy.id}`);
    await page.goForward();
    await page.waitForFunction(
      (id) => window.h.state.serverDrawing?.id === id,
      original.id,
    );
    await draw(page, 1100);
    acceptDialog = false;
    await page.goBack();
    await page.waitForURL(`${uiURL}/drawing/${original.id}`);
    assert.equal((await identity()).id, original.id);
    assert.equal(
      await page.evaluate(
        () => window.h.elements.filter((el) => !el.isDeleted).length,
      ),
      4,
    );
    acceptDialog = true;
    await page.goBack();
    await page.waitForFunction(
      (id) => window.h.state.serverDrawing?.id === id,
      copy.id,
    );
    await page.goForward();
    await page.waitForFunction(
      (id) => window.h.state.serverDrawing?.id === id,
      original.id,
    );
    assert.equal(
      await page.evaluate(
        () => window.h.elements.filter((el) => !el.isDeleted).length,
      ),
      3,
    );
  });
  await test("dirty-load cancellation preserves canvas; acceptance restores saved scene", async () => {
    await draw(page, 1100);
    await openGallery();
    acceptDialog = false;
    await loadFromGallery("Copy drawing");
    assert.equal((await identity()).id, original.id);
    assert.equal(
      await page.evaluate(
        () => window.h.elements.filter((el) => !el.isDeleted).length,
      ),
      4,
    );
    acceptDialog = true;
    await loadFromGallery("Copy drawing");
    await dialog().waitFor({ state: "hidden" });
    assert.equal((await identity()).id, copy.id);
    assert.equal(
      await page.evaluate(
        () => window.h.elements.filter((el) => !el.isDeleted).length,
      ),
      3,
    );
  });
  await test("network failure preserves changes and retry succeeds", async () => {
    await draw();
    await page.route("**/api/drawings/*", (route) =>
      route.request().method() === "PUT" ? route.abort() : route.continue(),
    );
    await page.keyboard.press("Control+s");
    await dialog()
      .getByRole("alert")
      .filter({ hasText: "Cannot reach" })
      .waitFor();
    assert.equal((await get(copy.id)).scene.elements.length, 3);
    await page.unroute("**/api/drawings/*");
    await dialog().getByRole("button", { name: "Save", exact: true }).click();
    await dialog().getByText("Saved to server", { exact: true }).waitFor();
    copy = await identity();
    await closeGallery();
  });
  await test("another browser cannot silently overwrite or delete a newer revision", async () => {
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    other.on("dialog", (d) => d.accept());
    await other.goto(uiURL);
    await openGallery(other);
    await loadFromGallery("Copy drawing", other);
    await dialog(other).waitFor({ state: "hidden" });
    await draw();
    await page.keyboard.press("Control+s");
    await page.waitForFunction(
      (revision) => window.h.state.serverDrawing?.revision !== revision,
      copy.revision,
    );
    await draw(other);
    await other.keyboard.press("Control+s");
    await dialog(other)
      .getByRole("alert")
      .filter({ hasText: "changed on the server" })
      .waitFor();
    const staleDelete = await fetch(`${apiURL}/api/drawings/${copy.id}`, {
      method: "DELETE",
      headers: { "If-Match": `"${copy.revision}"` },
    });
    assert.equal(staleDelete.status, 409);
    await dialog(other)
      .getByLabel("Drawing name", { exact: true })
      .fill("Recovered conflict");
    await dialog(other)
      .getByRole("button", { name: "Save as copy", exact: true })
      .click();
    await dialog(other).getByText("Saved to server", { exact: true }).waitFor();
    await otherContext.close();
    copy = await identity();
  });
  await test("clear canvas detaches server identity", async () => {
    await page.getByTestId("main-menu-trigger").click();
    await page.getByText("Reset the canvas", { exact: true }).click();
    await page
      .getByRole("dialog", { name: "Clear canvas", exact: true })
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await page.waitForFunction(() => window.h.state.serverDrawing === null);
    assert.equal((await get(copy.id)).scene.elements.length, 5);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await dialog().getByText("Not saved to server", { exact: true }).waitFor();
    await closeGallery();
  });
  await test("file import detaches identity; Arabic text, images and background round-trip", async () => {
    await openGallery();
    await loadFromGallery("Renamed drawing");
    await dialog().waitFor({ state: "hidden" });
    const scene = (await get(original.id)).scene;
    const rectangle = scene.elements[0];
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 16;
      c.height = 16;
      c.getContext("2d").fillRect(0, 0, 16, 16);
      return c.toDataURL();
    });
    const fixture = {
      ...scene,
      elements: [
        {
          ...rectangle,
          id: "arabic-text",
          type: "text",
          x: 50,
          y: 50,
          width: 200,
          height: 65,
          text: "مرحبا بالعالم\nاختبار الحفظ",
          originalText: "مرحبا بالعالم\nاختبار الحفظ",
          fontSize: 20,
          fontFamily: 12,
          lineHeight: 1.625,
          textAlign: "right",
          verticalAlign: "top",
          containerId: null,
          autoResize: true,
        },
        {
          ...rectangle,
          id: "embedded-image",
          type: "image",
          x: 350,
          y: 150,
          width: 160,
          height: 160,
          fileId: "qa-image",
          status: "saved",
          scale: [1, 1],
          crop: null,
        },
      ],
      appState: { ...scene.appState, viewBackgroundColor: "#ffec99" },
      files: {
        "qa-image": {
          id: "qa-image",
          mimeType: "image/png",
          dataURL: png,
          created: 1,
        },
      },
    };
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Control+o");
    await (
      await chooser
    ).setFiles({
      name: "fixture.excalidraw",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await page.waitForFunction(() =>
      window.h.elements.some((el) => el.id === "embedded-image"),
    );
    assert.equal(await identity(), null);
    assert.equal(new URL(page.url()).pathname, "/");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await dialog()
      .getByLabel("Drawing name", { exact: true })
      .fill("Image and Arabic");
    await dialog().getByRole("button", { name: "Save", exact: true }).click();
    await dialog().getByText("Saved to server", { exact: true }).waitFor();
    const imageDrawing = await identity();
    const saved = (await get(imageDrawing.id)).scene;
    const freshContext = await browser.newContext();
    const fresh = await freshContext.newPage();
    await fresh.goto(page.url());
    await fresh.waitForFunction(() => !!window.h?.app.files["qa-image"]);
    assert.equal(
      await fresh.evaluate(() => window.h.app.files["qa-image"].dataURL),
      png,
    );
    assert.equal((await identity(fresh)).id, imageDrawing.id);
    await freshContext.close();

    assert.equal(saved.files["qa-image"].dataURL, png);
    assert.equal(saved.appState.viewBackgroundColor, "#ffec99");
    assert.equal(saved.appState.serverDrawing, undefined);
    await dialog()
      .getByRole("img", { name: "Preview of Image and Arabic", exact: true })
      .waitFor();
    await loadFromGallery("Renamed drawing");
    await dialog().waitFor({ state: "hidden" });
    await openGallery();
    await loadFromGallery("Image and Arabic");
    await dialog().waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() => window.h.app.files["qa-image"].dataURL),
      png,
    );
    assert.equal(
      await page.evaluate(() => window.h.state.viewBackgroundColor),
      "#ffec99",
    );
    assert.equal(
      await page.evaluate(
        () => window.h.elements.find((el) => el.type === "text").text,
      ),
      "مرحبا بالعالم\nاختبار الحفظ",
    );
    await persisted();
    await page.reload();
    await openGallery();
    await dialog().getByText("Saved to server", { exact: true }).waitFor();
  });
  await test("cancel deletion preserves the file; deleting the active copy keeps the canvas", async () => {
    const active = await identity();
    const before = await page.evaluate(() => JSON.stringify(window.h.elements));
    acceptDialog = false;
    await dialog()
      .getByRole("button", { name: "Delete Image and Arabic", exact: true })
      .click();
    assert.equal((await get(active.id)).id, active.id);
    acceptDialog = true;
    await dialog()
      .getByRole("button", { name: "Delete Image and Arabic", exact: true })
      .click();
    await page.waitForFunction(() => window.h.state.serverDrawing === null);
    assert.equal(
      (await fetch(`${apiURL}/api/drawings/${active.id}`)).status,
      404,
    );
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.h.elements)),
      before,
    );
    await dialog()
      .getByLabel("Drawing name", { exact: true })
      .fill("Resaved images");
    await dialog().getByRole("button", { name: "Save", exact: true }).click();
    await dialog().getByText("Saved to server", { exact: true }).waitFor();
    await closeGallery();
  });
  await test("slow save tracks later edits and prevents duplicate requests", async () => {
    const before = await identity();
    let resolveRequest;
    let intercepted;
    const requestSeen = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    await page.route("**/api/drawings/*", async (route) => {
      if (route.request().method() === "PUT") {
        intercepted = route;
        resolveRequest();
      } else {
        await route.continue();
      }
    });
    await draw();
    await page.keyboard.press("Control+s");
    await requestSeen;
    await page.keyboard.press("Control+s");
    await draw(page, 800);
    await intercepted.continue();
    await page.unroute("**/api/drawings/*");
    await page.waitForFunction(
      (revision) => window.h.state.serverDrawing?.revision !== revision,
      before.revision,
    );
    await openGallery();
    await dialog().getByText("Unsaved changes", { exact: true }).waitFor();
    await dialog().getByRole("button", { name: "Save", exact: true }).click();
    await dialog().getByText("Saved to server", { exact: true }).waitFor();
    await closeGallery();
  });
  await test("retry after a lost create response does not duplicate the drawing", async () => {
    await openGallery();
    await dialog()
      .getByLabel("Drawing name", { exact: true })
      .fill("Lost response copy");
    const before = (await list()).length;
    const beforeURL = page.url();
    await page.route("**/api/drawings", async (route) => {
      if (route.request().method() === "POST") {
        await route.fetch();
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await dialog()
      .getByRole("button", { name: "Save as copy", exact: true })
      .click();
    await dialog()
      .getByRole("alert")
      .filter({ hasText: "Cannot reach" })
      .waitFor();
    assert.equal((await list()).length, before + 1);
    assert.equal(page.url(), beforeURL);
    await page.unroute("**/api/drawings");
    await dialog()
      .getByRole("button", { name: "Save as copy", exact: true })
      .click();
    await dialog().getByText("Saved to server", { exact: true }).waitFor();
    assert.equal((await list()).length, before + 1);
    await closeGallery();
  });
  await test("mobile gallery fits the viewport and supports saving", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGallery();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await dialog()
      .getByLabel("Drawing name", { exact: true })
      .fill("Mobile save");
    await dialog().getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(
      () => window.h.state.serverDrawing?.name === "Mobile save",
    );
    await page.screenshot({ path: path.join(temporary, "mobile.png") });
    // Mobile dialogs also have an icon-only Close button.
    await dialog()
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await test("two tabs keep separate canvases when switching focus and reloading", async () => {
    const before = await identity();
    const elements = await page.evaluate(() =>
      JSON.stringify(window.h.elements),
    );
    const other = await context.newPage();
    other.on("dialog", (d) => d.accept());
    await other.goto(uiURL);
    await openGallery(other);
    await loadFromGallery("Renamed drawing", other);
    await dialog(other).waitFor({ state: "hidden" });
    await persisted(other);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(1000); // Cross-tab synchronization is deliberately debounced.
    assert.equal((await identity()).id, before.id);
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.h.elements)),
      elements,
    );
    await page.reload();
    await page.getByRole("button", { name: "Drawings", exact: true }).waitFor();
    assert.equal((await identity()).id, before.id);
    await other.close();
  });
  await test("menus retain normal share, export and help without paid/social/AI promotions", async () => {
    await page.getByTestId("main-menu-trigger").click();
    const menuText = await page.locator("body").innerText();
    assert.doesNotMatch(
      menuText,
      /Excalidraw\+|Sign up|Follow us|Discord|Generate with AI/,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByText("Live collaboration", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("?");
    await page.getByRole("dialog", { name: "Help", exact: true }).waitFor();
    const help = await page.locator("body").innerText();
    assert.doesNotMatch(help, /Documentation|Blog|YouTube/);
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog", { name: "Help", exact: true })
      .waitFor({ state: "hidden" });
    await openGallery();
    await page.screenshot({ path: path.join(temporary, "desktop.png") });
    await closeGallery();
  });
  await test("New clears the URL; first save assigns an ID; Back returns to the saved drawing", async () => {
    const freshContext = await browser.newContext();
    const fresh = await freshContext.newPage();
    fresh.on("dialog", (d) => d.accept());
    await fresh.goto(`${uiURL}/drawing/${original.id}`);
    await fresh.waitForFunction(
      (id) => window.h?.state.serverDrawing?.id === id,
      original.id,
    );
    await fresh.getByRole("button", { name: "New", exact: true }).click();
    await fresh.waitForURL(`${uiURL}/`);
    await fresh.waitForFunction(() => window.h.state.serverDrawing === null);
    assert.equal(await fresh.evaluate(() => window.h.elements.length), 0);
    await draw(fresh);
    await fresh.keyboard.press("Control+s");
    await dialog(fresh)
      .getByLabel("Drawing name", { exact: true })
      .fill("URL first save");
    await dialog(fresh)
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await dialog(fresh).getByText("Saved to server", { exact: true }).waitFor();
    const created = await identity(fresh);
    assert.notEqual(created.id, original.id);
    assert.equal(new URL(fresh.url()).pathname, `/drawing/${created.id}`);
    await closeGallery(fresh);
    await fresh.goBack();
    await fresh.waitForFunction(
      (id) => window.h.state.serverDrawing?.id === id,
      original.id,
    );
    await freshContext.close();
  });
  await test("failed gallery loads keep the current URL and canvas", async () => {
    const beforeURL = page.url();
    const before = await identity();
    await openGallery();
    await page.route(`**/api/drawings/${original.id}`, (route) =>
      route.abort(),
    );
    await loadFromGallery("Renamed drawing");
    await dialog()
      .getByRole("alert")
      .filter({ hasText: "Cannot reach" })
      .waitFor();
    assert.equal(page.url(), beforeURL);
    assert.deepEqual(await identity(), before);
    await page.unroute(`**/api/drawings/${original.id}`);
    await closeGallery();
  });
  await test("pre-URL drafts retain their edits as unnamed canvases on upgrade", async () => {
    const freshContext = await browser.newContext();
    const legacy = await get(original.id);
    await freshContext.addInitScript((drawing) => {
      sessionStorage.setItem(
        "arabidraw-tab-draft",
        JSON.stringify({
          elements: drawing.scene.elements,
          appState: { ...drawing.scene.appState, serverDrawing: drawing },
        }),
      );
    }, legacy);
    const fresh = await freshContext.newPage();
    await fresh.goto(uiURL);
    await fresh.getByRole("button", { name: "Save", exact: true }).waitFor();
    assert.equal(await identity(fresh), null);
    assert.equal(
      await fresh.evaluate(() => window.h.elements.length),
      legacy.scene.elements.length,
    );
    assert.equal(new URL(fresh.url()).pathname, "/");
    await freshContext.close();
  });
  await test("unnamed drafts warn on reload and remain unsaved without creating server files", async () => {
    const freshContext = await browser.newContext();
    const fresh = await freshContext.newPage();
    let warnings = 0;
    const writes = [];
    fresh.on("dialog", (d) => {
      if (d.type() === "beforeunload") {
        warnings++;
      }
      return d.accept();
    });
    fresh.on("request", (request) => {
      if (
        request.url().includes("/api/drawings") &&
        request.method() !== "GET"
      ) {
        writes.push(request.method());
      }
    });
    const drawingsBefore = await list();
    await fresh.goto(uiURL);
    await fresh.getByRole("button", { name: "Save", exact: true }).waitFor();
    await draw(fresh);
    const before = await canvasSnapshot(fresh);
    await fresh.reload();
    await openGallery(fresh);
    await dialog(fresh)
      .getByText("Not saved to server", { exact: true })
      .waitFor();
    assert.equal(warnings, 1);
    assert.equal(await identity(fresh), null);
    assert.equal(new URL(fresh.url()).pathname, "/");
    assert.equal(await canvasSnapshot(fresh), before);
    assert.deepEqual(writes, []);
    assert.deepEqual(await list(), drawingsBefore);
    await freshContext.close();
  });
  await test("invalid and missing drawing URLs show an error without restoring another canvas", async () => {
    const freshContext = await browser.newContext();
    const fresh = await freshContext.newPage();
    for (const id of ["bad-id", "00000000-0000-4000-8000-000000000000"]) {
      await fresh.goto(`${uiURL}/drawing/${id}`);
      await fresh
        .getByText(
          id === "bad-id" ? "Invalid drawing ID" : "Drawing not found",
          { exact: true },
        )
        .waitFor();
      assert.equal(await identity(fresh), null);
      assert.equal(await fresh.evaluate(() => window.h.elements.length), 0);
      assert.equal(new URL(fresh.url()).pathname, `/drawing/${id}`);
    }
    await freshContext.close();
  });
  await test("folders organize drawings without changing saved content, URL or unsaved edits", async () => {
    const active = await identity();
    const beforeDrawing = await get(active.id);
    const beforeURL = page.url();
    await draw(page, 750);
    const unsaved = await canvasSnapshot();
    await openGallery();
    await dialog()
      .getByRole("button", { name: "+ New folder", exact: true })
      .click();
    await dialog()
      .getByLabel("New folder name", { exact: true })
      .fill("مشاريع");
    await dialog()
      .getByRole("button", { name: "Create folder", exact: true })
      .click();
    await dialog()
      .getByRole("navigation", { name: "Drawing folders" })
      .getByRole("button", { name: "مشاريع 0", exact: true })
      .waitFor();
    const catalog = await (
      await fetch(`${apiURL}/api/drawings/folders`)
    ).json();
    assert.ok(catalog.folders.find((item) => item.name === "مشاريع"));
    const card = dialog().locator(`[data-drawing-id="${active.id}"]`);
    const folderNav = dialog().getByRole("navigation", {
      name: "Drawing folders",
    });
    assert.equal(await dialog().locator("select").count(), 0);
    await card.scrollIntoViewIfNeeded();
    // Grabbing the preview moves the drawing, not the thumbnail image.
    await dialog()
      .getByRole("region", { name: "Drawing preview", exact: true })
      .getByRole("img")
      .dragTo(folderNav.getByRole("button", { name: "مشاريع 0", exact: true }));
    await dialog()
      .getByRole("navigation", { name: "Drawing folders" })
      .getByRole("button", { name: "مشاريع 1", exact: true })
      .click();
    assert.equal(
      await dialog()
        .getByRole("list", { name: "Saved drawings" })
        .locator("li")
        .count(),
      1,
    );
    await dialog()
      .getByLabel("Search drawings", { exact: true })
      .fill("does not exist");
    await dialog().getByText("No drawings match your search.").waitFor();
    await dialog()
      .getByLabel("Search drawings", { exact: true })
      .fill(active.name.toUpperCase());
    await dialog()
      .getByRole("button", { name: `Load ${active.name}`, exact: true })
      .waitFor();
    await dialog().getByLabel("Search drawings", { exact: true }).fill("");
    await dialog()
      .getByRole("button", { name: "Edit folder", exact: true })
      .click();
    await dialog().getByLabel("Folder name", { exact: true }).fill("Projects");
    await dialog()
      .getByRole("button", { name: "Save folder", exact: true })
      .click();
    await dialog()
      .getByRole("heading", { name: "Projects", exact: true })
      .waitFor();
    // Same-folder and invalid drops must not issue a request.
    const writesBeforeNoOp = serverWrites.length;
    await card.dragTo(
      folderNav.getByRole("button", { name: "Projects 1", exact: true }),
    );
    await card.dragTo(
      folderNav.getByRole("button", { name: /^All drawings / }),
    );
    assert.equal(serverWrites.length, writesBeforeNoOp);
    // Drag from a folder back to Home, then into the folder again.
    await card.dragTo(folderNav.getByRole("button", { name: /^Home / }));
    await folderNav
      .getByRole("button", { name: "Projects 0", exact: true })
      .waitFor();
    await folderNav.getByRole("button", { name: /^Home / }).click();
    await card.click();
    await dialog().getByText("Folder: Home", { exact: true }).waitFor();
    await card.dragTo(
      folderNav.getByRole("button", { name: "Projects 0", exact: true }),
    );
    await folderNav
      .getByRole("button", { name: "Projects 1", exact: true })
      .click();
    // The move fallback is usable without dragging; Escape cancels it.
    await dialog()
      .getByRole("button", { name: `Move ${active.name}`, exact: true })
      .click({ trial: true });
    await dialog()
      .getByRole("button", { name: `Move ${active.name}`, exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await dialog()
      .getByRole("button", { name: "Cancel move", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await dialog()
      .getByRole("button", { name: "Cancel move", exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(page.url(), beforeURL);
    assert.deepEqual(await identity(), active);
    assert.equal(await canvasSnapshot(), unsaved);
    assert.deepEqual(await get(active.id), beforeDrawing);
    await dialog().getByText("Unsaved changes", { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(temporary, "folders-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.equal(
      await dialog().evaluate((node) => node.scrollWidth <= node.clientWidth),
      true,
    );
    // Mobile users select Move then tap the destination in the folder list.
    await dialog()
      .getByRole("button", { name: `Move ${active.name}`, exact: true })
      .click();
    await folderNav.getByRole("button", { name: /^Home / }).click();
    await folderNav
      .getByRole("button", { name: "Projects 0", exact: true })
      .waitFor();
    await folderNav.getByRole("button", { name: /^Home / }).click();
    await dialog()
      .getByRole("button", { name: `Move ${active.name}`, exact: true })
      .click();
    await folderNav
      .getByRole("button", { name: "Projects 0", exact: true })
      .click();
    await folderNav
      .getByRole("button", { name: "Projects 1", exact: true })
      .click();
    await page.screenshot({ path: path.join(temporary, "folders-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await closeGallery();
    const writesBefore = serverWrites.length;
    await page.reload();
    await openGallery();
    assert.equal(serverWrites.length, writesBefore);
    await dialog().getByText("Unsaved changes", { exact: true }).waitFor();
    assert.equal(await canvasSnapshot(), unsaved);
    assert.deepEqual(await get(active.id), beforeDrawing);
    await dialog()
      .getByRole("navigation", { name: "Drawing folders" })
      .getByRole("button", { name: "Projects 1", exact: true })
      .click();
    await dialog()
      .getByRole("button", { name: `Load ${active.name}`, exact: true })
      .waitFor();
    // A fresh tab sees the assignment, and moving does not break direct drawing URLs.
    const fresh = await context.newPage();
    await fresh.goto(beforeURL);
    await openGallery(fresh);
    await dialog(fresh)
      .getByText("Folder: Projects", { exact: true })
      .waitFor();
    await fresh.close();
    acceptDialog = false;
    await dialog()
      .getByRole("button", { name: "Delete folder", exact: true })
      .click();
    assert.equal(
      (await (await fetch(`${apiURL}/api/drawings/folders`)).json()).folders
        .length,
      1,
    );
    acceptDialog = true;
    const allBefore = await list();
    await dialog()
      .getByRole("button", { name: "Delete folder", exact: true })
      .click();
    await dialog()
      .getByRole("heading", { name: "All drawings", exact: true })
      .waitFor();
    await card.click();
    await dialog().getByText("Folder: Home", { exact: true }).waitFor();
    assert.deepEqual(await list(), allBefore);
    assert.deepEqual(await get(active.id), beforeDrawing);
    assert.equal(await canvasSnapshot(), unsaved);
    await closeGallery();
  });
  await test("folder validation, failed moves, concurrent updates and restart persistence", async () => {
    const request = (suffix, method, body) =>
      fetch(`${apiURL}/api/drawings${suffix}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    for (const name of ["", "  ", "x".repeat(201)]) {
      assert.equal((await request("/folders", "POST", { name })).status, 400);
    }
    const creates = await Promise.all([
      request("/folders", "POST", { name: "Work" }),
      request("/folders", "POST", { name: "Personal" }),
    ]);
    assert.deepEqual(
      creates.map((response) => response.status),
      [201, 201],
    );
    let catalog = await (await request("/folders", "GET")).json();
    assert.equal(catalog.folders.length, 2);
    const work = catalog.folders.find((item) => item.name === "Work");
    const personal = catalog.folders.find((item) => item.name === "Personal");
    assert.equal(
      (await request("/folders", "POST", { name: " work " })).status,
      409,
    );
    assert.equal(
      (await request(`/folders/${personal.id}`, "PUT", { name: "Work" }))
        .status,
      409,
    );
    const absent = "00000000-0000-4000-8000-000000000000";
    assert.equal((await request(`/folders/${absent}`, "DELETE")).status, 404);
    assert.equal(
      (await request(`/folders/not-valid`, "PUT", { name: "Invalid" })).status,
      400,
    );
    const active = await identity();
    const documentBefore = await get(active.id);
    assert.equal(
      (await request(`/${active.id}/folder`, "PUT", {})).status,
      400,
    );
    assert.equal(
      (await request(`/${active.id}/folder`, "PUT", { folderId: absent }))
        .status,
      404,
    );
    assert.equal(
      (await request(`/${absent}/folder`, "PUT", { folderId: work.id })).status,
      404,
    );
    const moves = await Promise.all([
      request(`/${active.id}/folder`, "PUT", { folderId: work.id }),
      request(`/${original.id}/folder`, "PUT", { folderId: personal.id }),
    ]);
    assert.deepEqual(
      moves.map((response) => response.status),
      [200, 200],
    );
    catalog = await (await request("/folders", "GET")).json();
    assert.equal(catalog.drawingFolders[active.id], work.id);
    assert.equal(catalog.drawingFolders[original.id], personal.id);
    assert.deepEqual(await get(active.id), documentBefore);
    // Server failures leave the existing selection and saved scene intact.
    await openGallery();
    await page.route(`**/api/drawings/${active.id}/folder`, (route) =>
      route.abort(),
    );
    await dialog()
      .getByRole("button", { name: `Move ${active.name}`, exact: true })
      .click();
    await dialog()
      .getByRole("navigation", { name: "Drawing folders" })
      .getByRole("button", { name: /^Personal / })
      .click();
    await dialog()
      .getByRole("alert")
      .filter({ hasText: "Cannot reach" })
      .waitFor();
    await dialog().getByText("Folder: Work", { exact: true }).waitFor();
    await page.unroute(`**/api/drawings/${active.id}/folder`);
    await closeGallery();
    api.kill("SIGTERM");
    await once(api, "exit");
    api = startAPI();
    await waitForServer(`${apiURL}/api/drawings`, api);
    assert.deepEqual(await (await request("/folders", "GET")).json(), catalog);
    assert.deepEqual(await get(active.id), documentBefore);
    assert.equal(
      (await request(`/${active.id}/folder`, "PUT", { folderId: null })).status,
      200,
    );
    assert.equal(
      (await (await request("/folders", "GET")).json()).drawingFolders[
        active.id
      ],
      undefined,
    );
  });
  await test("split preview, legacy top-level folders, nested creation and safe reparenting", async () => {
    const request = (suffix, method = "GET", body) =>
      fetch(`${apiURL}/api/drawings${suffix}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const catalogPath = path.join(temporary, "drawings", ".folders.json");
    const beforeMigration = await (await request("/folders")).json();
    // Real pre-hierarchy catalogs have no parentId. Reading them must not
    // place existing folders under Home or rewrite the user's catalog.
    const legacy = JSON.stringify({
      ...beforeMigration,
      folders: beforeMigration.folders.map(({ id, name }) => ({ id, name })),
    });
    await fs.writeFile(catalogPath, legacy);
    const migrated = await (await request("/folders")).json();
    assert.ok(migrated.folders.every((folder) => folder.parentId === null));
    assert.equal(await fs.readFile(catalogPath, "utf8"), legacy);
    const active = await identity();
    const canvasBefore = await canvasSnapshot();
    const documentBefore = await get(active.id);
    const urlBefore = page.url();
    await openGallery();
    const writesBefore = serverWrites.length;
    await dialog()
      .getByRole("button", { name: "Preview Renamed drawing", exact: true })
      .click();
    await dialog()
      .getByRole("img", { name: "Preview of Renamed drawing", exact: true })
      .waitFor();
    assert.equal(await dialog().getByRole("img").count(), 1);
    assert.deepEqual(await identity(), active);
    assert.equal(await canvasSnapshot(), canvasBefore);
    assert.equal(serverWrites.length, writesBefore);
    const nav = dialog().getByRole("navigation", { name: "Drawing folders" });
    const newFolder = async (name, parentId) => {
      await dialog()
        .getByRole("button", { name: "+ New folder", exact: true })
        .click();
      assert.equal(
        await dialog()
          .getByLabel("Parent folder", { exact: true })
          .inputValue(),
        parentId ?? "",
      );
      await dialog().getByLabel("New folder name", { exact: true }).fill(name);
      await dialog()
        .getByRole("button", { name: "Create folder", exact: true })
        .click();
      await dialog()
        .getByLabel("New folder name", { exact: true })
        .waitFor({ state: "hidden" });
      return (await (await request("/folders")).json()).folders.find(
        (folder) => folder.name === name && folder.parentId === parentId,
      );
    };
    const course = await newFolder("AI Course", null);
    assert.ok(course);
    const courseNode = nav.locator(`[data-folder-id="${course.id}"]`);
    assert.equal(await courseNode.getAttribute("data-parent-id"), "top-level");
    assert.equal(
      await courseNode.evaluate(
        (node) =>
          node.parentElement ===
          document.querySelector('[data-folder-id="home"]').parentElement,
      ),
      true,
    );
    await nav.getByRole("button", { name: "AI Course 0", exact: true }).click();
    const intro = await newFolder("Introduction", course.id);
    assert.ok(intro);
    await nav
      .getByRole("button", { name: "Introduction 0", exact: true })
      .click();
    const lesson = await newFolder("Lesson 1", intro.id);
    assert.ok(lesson);
    assert.equal(
      await nav
        .locator(`[data-folder-id="${lesson.id}"]`)
        .getAttribute("data-parent-id"),
      intro.id,
    );
    await nav.getByRole("button", { name: "AI Course 0", exact: true }).click();
    await dialog()
      .getByRole("button", { name: "Edit folder", exact: true })
      .click();
    const parentSelect = dialog().getByLabel("Parent folder", { exact: true });
    for (const id of [course.id, intro.id, lesson.id]) {
      assert.equal(
        await parentSelect.locator(`option[value="${id}"]`).count(),
        0,
      );
    }
    await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
    const beforeInvalid = await (await request("/folders")).json();
    assert.equal(
      (
        await request(`/folders/${course.id}`, "PUT", {
          name: course.name,
          parentId: lesson.id,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(`/folders/${intro.id}`, "PUT", {
          name: intro.name,
          parentId: intro.id,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/folders", "POST", {
          name: "Bad parent",
          parentId: "invalid",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/folders", "POST", {
          name: "Missing parent",
          parentId: "00000000-0000-4000-8000-000000000000",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request("/folders", "POST", {
          name: "Introduction",
          parentId: course.id,
        })
      ).status,
      409,
    );
    assert.deepEqual(await (await request("/folders")).json(), beforeInvalid);
    // The same name in a different parent is valid, but moving onto it isn't.
    let response = await request("/folders", "POST", {
      name: "Introduction",
      parentId: null,
    });
    assert.equal(response.status, 201);
    const duplicate = (await response.json()).folders.find(
      (folder) => folder.name === "Introduction" && folder.parentId === null,
    );
    assert.equal(
      (
        await request(`/folders/${intro.id}`, "PUT", {
          name: intro.name,
          parentId: null,
        })
      ).status,
      409,
    );
    assert.equal(
      (await request(`/folders/${duplicate.id}`, "DELETE")).status,
      200,
    );
    // Old clients may rename without providing a parent; keep the location.
    response = await request(`/folders/${intro.id}`, "PUT", {
      name: intro.name,
    });
    assert.equal(
      (await response.json()).folders.find((folder) => folder.id === intro.id)
        .parentId,
      course.id,
    );
    await nav
      .getByRole("button", { name: "Introduction 0", exact: true })
      .click();
    await dialog()
      .getByRole("button", { name: "Edit folder", exact: true })
      .click();
    assert.equal(await parentSelect.inputValue(), course.id);
    await parentSelect.selectOption("");
    await dialog()
      .getByRole("button", { name: "Save folder", exact: true })
      .click();
    await page.waitForFunction(
      (id) =>
        document
          .querySelector(`[data-folder-id="${id}"]`)
          ?.getAttribute("data-parent-id") === "top-level",
      intro.id,
    );
    assert.equal(
      (await (await request("/folders")).json()).folders.find(
        (folder) => folder.id === lesson.id,
      ).parentId,
      intro.id,
    );
    // Home is a peer by default, and can be selected as an explicit parent.
    await nav.getByRole("button", { name: /^Home / }).click();
    await dialog()
      .getByRole("button", { name: "+ New folder", exact: true })
      .click();
    assert.equal(await parentSelect.inputValue(), "");
    await parentSelect.selectOption("home");
    await dialog()
      .getByLabel("New folder name", { exact: true })
      .fill("Home subfolder");
    await dialog()
      .getByRole("button", { name: "Create folder", exact: true })
      .click();
    await nav
      .getByRole("button", { name: "Home subfolder 0", exact: true })
      .waitFor();
    // Move into a nested folder without loading it or changing the canvas.
    await nav.getByRole("button", { name: /^All drawings / }).click();
    await dialog()
      .locator(`[data-drawing-id="${active.id}"]`)
      .dragTo(nav.getByRole("button", { name: "Lesson 1 0", exact: true }));
    await nav.getByRole("button", { name: "Lesson 1 1", exact: true }).click();
    await dialog()
      .getByText("Folder: Introduction / Lesson 1", { exact: true })
      .waitFor();
    assert.equal(page.url(), urlBefore);
    assert.deepEqual(await identity(), active);
    assert.equal(await canvasSnapshot(), canvasBefore);
    assert.deepEqual(await get(active.id), documentBefore);
    await nav.getByRole("button", { name: "AI Course 0", exact: true }).click();
    const moduleFolder = await newFolder("Module", course.id);
    await page.screenshot({
      path: path.join(temporary, "split-nested-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: path.join(temporary, "split-nested-mobile.png"),
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Preserve children on deletion, and reject promotion name conflicts.
    response = await request("/folders", "POST", { name: "Module" });
    const conflicting = (await response.json()).folders.find(
      (folder) => folder.name === "Module" && folder.parentId === null,
    );
    assert.equal(
      (await request(`/folders/${course.id}`, "DELETE")).status,
      409,
    );
    await request(`/folders/${conflicting.id}`, "DELETE");
    await dialog()
      .getByRole("button", { name: "Delete folder", exact: true })
      .click();
    await courseNode.waitFor({ state: "hidden" });
    const afterDelete = await (await request("/folders")).json();
    assert.equal(
      afterDelete.folders.find((folder) => folder.id === moduleFolder.id)
        .parentId,
      null,
    );
    assert.equal(afterDelete.drawingFolders[active.id], lesson.id);
    await closeGallery();
    api.kill("SIGTERM");
    await once(api, "exit");
    api = startAPI();
    await waitForServer(`${apiURL}/api/drawings`, api);
    assert.deepEqual(await (await request("/folders")).json(), afterDelete);
  });
  await test("API validation, concurrent saves and persistence after restart", async () => {
    assert.equal(
      (await fetch(`${apiURL}/api/drawings/not-a-uuid`)).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${apiURL}/api/drawings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "broken",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${apiURL}/api/drawings`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "{}",
        })
      ).status,
      415,
    );
    const current = await get((await identity()).id);
    const update = (name, revision = current.revision) =>
      fetch(`${apiURL}/api/drawings/${current.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${revision}"`,
        },
        body: JSON.stringify({ name, scene: current.scene }),
      });
    const responses = await Promise.all([
      update("Concurrent A"),
      update("Concurrent B"),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (
        await fetch(`${apiURL}/api/drawings/${current.id}`, {
          method: "DELETE",
        })
      ).status,
      428,
    );
    for (const name of ["", "x".repeat(201)]) {
      assert.equal(
        (
          await fetch(`${apiURL}/api/drawings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, scene: current.scene }),
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await fetch(`${apiURL}/api/drawings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Oversized",
            padding: "x".repeat(50 * 1024 * 1024),
            scene: current.scene,
          }),
        })
      ).status,
      413,
    );
    const beforeRestart = await list();
    api.kill("SIGTERM");
    await once(api, "exit");
    api = startAPI();
    await waitForServer(`${apiURL}/api/drawings`, api);
    assert.deepEqual(await list(), beforeRestart);
    assert.equal(
      (await fs.readdir(path.join(temporary, "drawings"))).some((name) =>
        name.endsWith(".tmp"),
      ),
      false,
    );
  });
  await test("visible thumbnails share cached renders, prioritize selection, and respect the two-job limit", async () => {
    const fixture = (await get(original.id)).scene;
    const seeds = await Promise.all(
      Array.from({ length: 40 }, async (_, index) => {
        const response = await fetch(`${apiURL}/api/drawings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `Thumbnail ${String(index + 1).padStart(2, "0")}`,
            scene: fixture,
          }),
        });
        assert.equal(response.status, 201);
        return response.json();
      }),
    );
    const freshContext = await browser.newContext({
      viewport: { width: 1920, height: 1200 },
    });
    const fresh = await freshContext.newPage();
    fresh.on("pageerror", (error) => pageErrors.push(error.message));
    await fresh.addInitScript(() => {
      window.previewEncodes = 0;
      const encode = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        window.previewEncodes++;
        return encode.apply(this, args);
      };
    });
    const requested = [];
    let inFlight = 0;
    let maximumInFlight = 0;
    let hold = true;
    const gates = [];
    const until = async (condition) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (condition()) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Timed out waiting for preview requests");
    };
    await fresh.route(/\/api\/drawings\/[0-9a-f-]{36}$/, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const id = route.request().url().split("/").pop();
      requested.push(id);
      inFlight++;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      try {
        if (hold) {
          await new Promise((resolve) => gates.push(resolve));
        }
        await route.fulfill({ response: await route.fetch() });
      } finally {
        inFlight--;
      }
    });
    await fresh.goto(uiURL);
    await openGallery(fresh);
    const gallery = dialog(fresh);
    const pane = gallery.getByRole("list", { name: "Saved drawings" });
    const bounds = await gallery.locator(".Modal__content").boundingBox();
    assert.ok(
      Math.abs(bounds.width - 1920 * 0.8) <= 2,
      `Desktop width ${bounds.width}`,
    );
    await until(() => requested.length === 2);
    assert.equal(maximumInFlight, 2);
    const visibleIds = await pane.evaluate((list) => {
      const clip = list.getBoundingClientRect();
      return [...list.querySelectorAll("[data-drawing-id]")]
        .filter((row) => {
          const rect = row.getBoundingClientRect();
          return (
            rect.top >= clip.top &&
            rect.bottom <= Math.min(clip.bottom, innerHeight)
          );
        })
        .map((row) => row.getAttribute("data-drawing-id"));
    });
    const priorityId = visibleIds.find((id) => !requested.includes(id));
    assert.ok(priorityId, "There is a queued visible thumbnail to select");
    await gallery.locator(`[data-drawing-id="${priorityId}"]`).click();
    gates.shift()();
    await until(() => requested.length >= 3);
    assert.equal(
      requested[2],
      priorityId,
      "Selected preview jumps ahead of queued thumbnails",
    );
    hold = false;
    for (const release of gates.splice(0)) {
      release();
    }
    const visibleThumbnailsLoaded = () =>
      fresh.waitForFunction(() => {
        const list = document.querySelector('ul[aria-label="Saved drawings"]');
        const clip = list.getBoundingClientRect();
        const thumbnails = [
          ...list.querySelectorAll('[data-drawing-id] [aria-hidden="true"]'),
        ].filter((node) => {
          const rect = node.getBoundingClientRect();
          return (
            rect.top < Math.min(clip.bottom, innerHeight) &&
            rect.bottom > Math.max(clip.top, 0)
          );
        });
        return (
          thumbnails.length > 0 &&
          thumbnails.every((node) => !!node.querySelector("img"))
        );
      });
    await visibleThumbnailsLoaded();
    assert.ok(
      requested.length < seeds.length / 2,
      "Offscreen drawings are not fetched",
    );
    assert.equal(maximumInFlight, 2);
    assert.equal(
      new Set(requested).size,
      requested.length,
      "Thumbnail and large preview share each request",
    );
    const cachedId = visibleIds.find((id) => id !== priorityId);
    const beforeRequests = requested.length;
    const beforeEncodes = await fresh.evaluate(() => window.previewEncodes);
    await gallery.locator(`[data-drawing-id="${cachedId}"]`).click();
    await gallery
      .getByRole("region", { name: "Drawing preview", exact: true })
      .getByRole("img")
      .waitFor();
    assert.equal(requested.length, beforeRequests);
    assert.equal(
      await fresh.evaluate(() => window.previewEncodes),
      beforeEncodes,
      "Cached selection does not render again",
    );
    await fresh.screenshot({
      path: path.join(temporary, "thumbnails-wide.png"),
    });
    await pane.evaluate((list) => {
      list.scrollTop = list.scrollHeight;
    });
    await visibleThumbnailsLoaded();
    assert.ok(
      requested.length < seeds.length,
      "Scrolling does not fetch the whole gallery",
    );
    assert.equal(maximumInFlight, 2);
    // Returning to an already-seen drawing uses the same cache; a new revision doesn't.
    const cached = seeds.find((item) => item.id === cachedId);
    assert.ok(cached);
    await gallery
      .getByLabel("Search drawings", { exact: true })
      .fill(cached.name);
    await visibleThumbnailsLoaded();
    const current = await get(cached.id);
    const updated = await fetch(`${apiURL}/api/drawings/${cached.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": `"${current.revision}"`,
      },
      body: JSON.stringify({
        name: cached.name,
        scene: {
          ...current.scene,
          appState: {
            ...current.scene.appState,
            viewBackgroundColor: "#ffd8a8",
          },
        },
      }),
    });
    assert.equal(updated.status, 200);
    const countBeforeRevision = requested.filter(
      (id) => id === cachedId,
    ).length;
    await gallery.getByRole("button", { name: "Refresh", exact: true }).click();
    await until(
      () =>
        requested.filter((id) => id === cachedId).length > countBeforeRevision,
    );
    await visibleThumbnailsLoaded();
    assert.equal(
      requested.filter((id) => id === cachedId).length,
      countBeforeRevision + 1,
    );
    await fresh.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await fresh.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await fresh.screenshot({
      path: path.join(temporary, "thumbnails-mobile.png"),
    });
    await freshContext.close();
  });
  console.log("Browser regression stages complete", { temporary, pageErrors });
  assert.deepEqual(pageErrors, []);
})()
  .catch(async (error) => {
    console.error(error);
    if (page && temporary) {
      await page
        .screenshot({
          path: path.join(temporary, "failure.png"),
          fullPage: true,
        })
        .catch(() => {});
      console.error(`Artifacts: ${temporary}`);
      console.error(
        (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(-5000),
      );
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    for (const child of children) {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
    }
  });
