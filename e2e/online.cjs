// Zwei Browser spielen online gegeneinander (Einladungslink + Lobby). node e2e/online.cjs [baseUrl]
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:3000";

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base);
    await p.waitForSelector(".mode-card");
    return p;
  };
  const a = await mk();
  const b = await mk();

  const sq = async (page, s) => {
    const b = await (await page.$(`.board-column [data-square="${s}"]`)).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const move = async (page, from, to) => {
    const p1 = await sq(page, from), p2 = await sq(page, to);
    await page.mouse.click(p1.x, p1.y);
    await page.mouse.click(p2.x, p2.y);
  };
  const waitPlies = (page, n) => page.waitForFunction((n) => document.querySelectorAll(".mv").length >= n, n, { timeout: 8000 });

  // --- Einladungslink
  await a.click("text=Freund");
  await a.click(".tc-chips >> text=3 | 2");
  await a.click(".segmented >> text=Weiß");
  await a.click("button:has-text('Einladung erstellen')");
  await a.waitForSelector(".waiting-card input");
  const link = await a.inputValue(".waiting-card input");
  await a.screenshot({ path: "screenshots/10-invite.png" });
  await b.goto(link);
  await b.click("text=Annehmen & spielen");
  await a.waitForSelector(".waiting-card", { state: "detached" });

  await move(a, "e2", "e4");
  await waitPlies(b, 1);
  await move(b, "e7", "e5");
  await waitPlies(a, 2);
  await move(a, "d1", "h5");
  await waitPlies(b, 3);
  await move(b, "b8", "c6");
  await waitPlies(a, 4);
  await move(a, "f1", "c4");
  await waitPlies(b, 5);
  await move(b, "g8", "f6");
  await waitPlies(a, 6);
  await b.fill(".chat input", "Viel Glück!");
  await b.press(".chat input", "Enter");
  await a.waitForSelector("text=Viel Glück!");
  await move(a, "h5", "f7");
  await a.waitForSelector(".modal");
  await b.waitForSelector(".modal");
  await a.waitForTimeout(500);
  console.log("A:", await a.textContent(".modal h2"), "| B:", await b.textContent(".modal h2"));
  await a.screenshot({ path: "screenshots/11-online-win.png" });

  // --- Lobby
  await a.goto(base + "/lobby");
  await a.click(".tc-chips >> text=1 min");
  await a.click("button:has-text('Gegner suchen')");
  await a.waitForSelector(".seek-waiting");
  await b.goto(base + "/lobby");
  await b.waitForSelector(".seek-table");
  await b.screenshot({ path: "screenshots/12-lobby.png" });
  await b.click(".seek-table >> text=Spielen");
  await Promise.all([a.waitForURL(/\/game\//), b.waitForURL(/\/game\//)]);
  console.log("Lobby-Paarung:", a.url() === b.url() ? "ok" : "FEHLER");
  console.log("JS-Fehler:", errors.length ? errors : "keine");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
