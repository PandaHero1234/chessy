// Manueller E2E-Smoke-Test: node e2e/smoke.cjs [baseUrl]  (Server muss laufen)
const { chromium } = require("playwright");
const base = process.argv[2] || "http://localhost:3000";
const out = (n) => `screenshots/${n}.png`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(base);
  await page.waitForSelector(".mode-card");
  await page.screenshot({ path: out("01-home"), fullPage: true });

  // Gegen Computer, Stufe 1, 5+3, Weiß
  await page.click("text=Computer");
  await page.click(".tc-chips >> text=5 | 3");
  await page.click(".segmented >> text=Weiß");
  await page.click("button:has-text('Spielen')");
  await page.waitForURL(/\/game\//);
  await page.waitForSelector(".board-column .board");

  const sq = async (s) => {
    const el = await page.$(`.board-column [data-square="${s}"]`);
    const b = await el.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const drag = async (from, to) => {
    const a = await sq(from), b = await sq(to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
  };
  const click = async (s) => { const p = await sq(s); await page.mouse.click(p.x, p.y); };
  const plies = () => page.$$eval(".mv", (els) => els.length);

  await drag("e2", "e4");
  await page.waitForFunction(() => document.querySelectorAll(".mv").length >= 2, null, { timeout: 10000 });
  // Klick-Klick-Zug
  await click("g1");
  await page.screenshot({ path: out("02-select") });
  await click("f3");
  await page.waitForFunction(() => document.querySelectorAll(".mv").length >= 4, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: out("03-game-vs-ai") });
  console.log("Züge:", await page.$$eval(".mv", (els) => els.map((e) => e.textContent).join(" ")));
  console.log("Uhren:", await page.$$eval(".clock", (els) => els.map((e) => e.textContent).join(" | ")));

  // Aufgeben → Ergebnisdialog
  await page.click("text=⚑ Aufgeben");
  await page.click("text=Wirklich aufgeben?");
  await page.waitForSelector(".modal");
  await page.waitForTimeout(500);
  await page.screenshot({ path: out("04-result") });
  await page.click(".modal >> text=Analysieren");
  await page.waitForSelector(".evalbar");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out("05-analysis") });

  // Mobil
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.goto(base);
  await m.waitForSelector(".mode-card");
  await m.screenshot({ path: out("06-mobile-home"), fullPage: true });
  await m.goto(page.url());
  await m.waitForSelector(".board");
  await m.waitForTimeout(500);
  await m.screenshot({ path: out("07-mobile-game"), fullPage: true });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log("Horizontaler Overflow mobil:", overflow);

  for (const p of ["/lobby", "/developers", "/settings", "/chesscom"]) {
    await page.goto(base + p);
    await page.waitForTimeout(400);
    await page.screenshot({ path: out("08" + p.replace("/", "-")), fullPage: true });
  }
  console.log("JS-Fehler:", errors.length ? errors : "keine");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
