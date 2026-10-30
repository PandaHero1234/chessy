// Testet den statischen Pages-Build (ohne Server). node e2e/static.cjs http://localhost:4000/chessy
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:4000/chessy";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/404/.test(m.text()) && errors.push(m.text()));
  const sq = async (s) => {
    const b = await (await page.$(`.board-column [data-square="${s}"]`)).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const move = async (from, to) => {
    const a = await sq(from), b = await sq(to);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
  };
  const plies = (n) => page.waitForFunction((n) => document.querySelectorAll(".mv").length >= n, n, { timeout: 15000 });

  await page.goto(base + "/");
  await page.waitForSelector(".mode-card");
  console.log("Online-Kachel deaktiviert:", await page.isDisabled(".mode-card:has-text('Online')"));
  await page.screenshot({ path: "screenshots/s1-home.png", fullPage: true });

  // Computer, Stufe 3, 3+2, Weiß – Stockfish läuft als Web Worker
  await page.click(".mode-card:has-text('Computer')");
  await page.click(".tc-chips >> text=3 | 2");
  await page.click(".segmented >> text=Weiß");
  await page.click("button:has-text('Spielen')");
  await page.waitForURL(/\/chessy\/game\//);
  await move("e2", "e4");
  await plies(2);
  await move("g1", "f3");
  await plies(4);
  console.log("Züge vs Stockfish:", await page.$$eval(".mv", (e) => e.map((x) => x.textContent).join(" ")));
  const url = page.url();

  // Reload behält Partie (localStorage) + Direktaufruf über 404.html
  await page.reload();
  await page.waitForSelector(".mv");
  console.log("Nach Reload Züge:", await page.$$eval(".mv", (e) => e.length));
  await page.screenshot({ path: "screenshots/s2-game.png" });

  // Analyse
  await page.click("text=⚑ Aufgeben");
  await page.click("text=Wirklich aufgeben?");
  await page.waitForSelector(".modal");
  await page.click(".modal >> text=Analysieren");
  await page.waitForSelector(".analysis-line", { timeout: 20000 });
  console.log("Analyse:", await page.textContent(".analysis-line"));

  // Lokale Partie bis Matt
  await page.goto(base + "/");
  await page.click(".mode-card:has-text('Lokal')");
  await page.click(".tc-chips >> text=1 min");
  await page.click("button:has-text('Spielen')");
  await page.waitForURL(/\/game\//);
  for (const [f, t] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) {
    const n = await page.$$eval(".mv", (e) => e.length);
    await move(f, t);
    await plies(n + 1);
  }
  await page.waitForSelector(".modal");
  console.log("Lokal:", await page.textContent(".modal h2"), "-", await page.textContent(".modal p"));

  await page.goto(base + "/lobby");
  await page.waitForSelector("h2");
  console.log("Lobby:", await page.textContent("main h2"));

  // Mobil (eigener Kontext → eigene, leere Partieliste): neue Partie gegen Computer
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await m.goto(base + "/");
  await m.click(".mode-card:has-text('Computer')");
  await m.click("button:has-text('Spielen')");
  await m.waitForSelector(".board-column .board");
  console.log("Mobil horizontaler Overflow:", await m.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await m.waitForTimeout(400);
  await m.screenshot({ path: "screenshots/s3-mobile.png", fullPage: true });
  console.log("JS-Fehler:", errors.length ? errors : "keine");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
