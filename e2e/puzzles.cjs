// Puzzle-E2E: Training (richtig/falsch/Tipp/Lösung), Tagespuzzle, Sturm, Puzzles aus eigener Partie.
//   node e2e/puzzles.cjs [baseUrl]      z. B. http://localhost:3000 oder http://localhost:4000/chessy
const { chromium } = require("playwright");
const { Chess } = require("chess.js");
const puzzles = require("../packages/puzzles/data/puzzles.json");
const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const byId = new Map(puzzles.map((p) => [p.id, p]));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  globalThis.__page = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/40[49]/.test(m.text()) && errors.push(m.text()));

  const sq = async (s) => {
    const b = await (await page.$(`.board-column [data-square="${s}"]`)).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const move = async (uci) => {
    const a = await sq(uci.slice(0, 2));
    const b = await sq(uci.slice(2, 4));
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    if (uci[4]) {
      // Umwandlungsauswahl: Reihenfolge q, n, r, b
      const idx = "qnrb".indexOf(uci[4]);
      await page.locator(".promo-piece").nth(idx).click();
    }
  };
  const currentId = async () => page.getAttribute("[data-puzzle-id]", "data-puzzle-id");
  const waitPlay = () => page.waitForSelector("[data-phase='play']", { timeout: 15000 });
  const solve = async (p) => {
    for (let i = 1; i < p.moves.length; i += 2) {
      await waitPlay();
      await move(p.moves[i]);
    }
  };

  // --- Training: richtig lösen
  await page.goto(base + "/puzzles");
  await page.waitForSelector(".puzzle-panel .rating-card");
  let p = byId.get(await currentId());
  console.log("Puzzle:", p.id, "Rating", p.rating, "Lösungszüge", Math.floor(p.moves.length / 2));
  await solve(p);
  await page.waitForSelector(".puzzle-status.good >> text=Gelöst");
  await page.waitForTimeout(300);
  console.log("Gelöst, Rating-Änderung:", (await page.textContent(".rating-delta").catch(() => "–")).trim(), "| Themen:", await page.$$eval(".theme-tags .badge", (e) => e.map((x) => x.textContent).join(", ")));
  await page.screenshot({ path: "screenshots/p1-solved.png" });

  // --- Weiter: falscher Zug, Tipp, Lösung
  await page.click("text=Weiter →");
  await page.waitForFunction((old) => document.querySelector("[data-puzzle-id]")?.getAttribute("data-puzzle-id") !== old, p.id);
  p = byId.get(await currentId());
  await waitPlay();
  const start = new Chess(p.fen);
  start.move({ from: p.moves[0].slice(0, 2), to: p.moves[0].slice(2, 4), promotion: p.moves[0][4] });
  const wrong = start.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || "")).find((u) => u !== p.moves[1] && !u[4]);
  await move(wrong);
  await page.waitForSelector(".puzzle-status.bad");
  console.log("Falscher Zug erkannt:", await page.textContent(".puzzle-status-title"));
  await waitPlay().catch(() => undefined);
  await page.waitForTimeout(900);
  await page.click("text=💡 Tipp");
  await page.waitForSelector(".sq-mark.hint");
  console.log("Tipp markiert Feld:", await page.$eval(".sq-mark.hint", (e) => e.parentElement.dataset.square), "(erwartet", p.moves[1].slice(0, 2) + ")");
  await page.screenshot({ path: "screenshots/p2-hint.png" });
  await page.click("text=👁 Lösung");
  await page.waitForSelector("text=Lösung angezeigt", { timeout: 20000 });
  console.log("Lösung angezeigt");

  // --- Tagespuzzle
  await page.click(".puzzle-tabs >> text=Tagespuzzle");
  await page.waitForSelector("text=Tagespuzzle vom");
  const daily = byId.get(await currentId());
  await solve(daily);
  await page.waitForSelector(".puzzle-status.good >> text=Gelöst");
  console.log("Tagespuzzle gelöst:", daily.id);

  // --- Puzzle-Sturm: zwei Puzzles lösen, dann ein Fehler
  await page.click(".puzzle-tabs >> text=Puzzle-Sturm");
  await page.waitForSelector(".storm-score");
  let prev = null;
  for (let k = 0; k < 2; k++) {
    await page.waitForFunction((prev) => {
      const id = document.querySelector("[data-puzzle-id]")?.getAttribute("data-puzzle-id");
      return id && id !== prev;
    }, prev);
    prev = await page.getAttribute("[data-puzzle-id]", "data-puzzle-id");
    const sp = byId.get(prev);
    await solve(sp);
  }
  await page.waitForFunction(() => document.querySelector(".storm-score")?.textContent === "2");
  console.log("Sturm: 2 gelöst, Uhr:", await page.textContent(".storm-clock"));
  await page.screenshot({ path: "screenshots/p3-storm.png" });

  // --- Eigene Partie: lokal Schäfermatt-Variante spielen, dann durchsuchen
  await page.goto(base + "/");
  await page.click(".mode-card:has-text('Lokal')");
  await page.click(".tc-chips >> text=∞");
  await page.click("button:has-text('Spielen')");
  await page.waitForURL(/\/game\//);
  await page.waitForSelector(".board-column [data-square='e2']");
  for (const m of ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]) {
    const n = await page.$$eval(".mv", (e) => e.length);
    await move(m);
    await page.waitForFunction((n) => document.querySelectorAll(".mv").length > n, n);
    await page.waitForTimeout(400);
  }
  await page.waitForSelector(".modal");
  await page.goto(base + "/puzzles/mine");
  await page.waitForSelector("text=Durchsuchen");
  await page.locator("button:has-text('Durchsuchen')").first().click();
  await page.waitForSelector(".game-row .badge", { timeout: 90000 });
  console.log("Eigene Partie durchsucht:", await page.textContent(".game-row .badge"));
  await page.click("text=Meine Puzzles lösen");
  await page.waitForSelector(".puzzle-panel");
  await waitPlay();
  console.log("Puzzle aus eigener Partie geladen:", await page.textContent(".puzzle-panel .muted.small:has-text('Puzzle')"));
  await move("h5f7");
  await page.waitForSelector(".puzzle-status.good >> text=Gelöst");
  console.log("Eigenes Puzzle gelöst (Dxf7#)");
  await page.screenshot({ path: "screenshots/p4-mine.png" });

  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await m.goto(base + "/puzzles");
  await m.waitForSelector(".puzzle-panel .rating-card");
  await m.waitForTimeout(800);
  await m.screenshot({ path: "screenshots/p5-mobile.png", fullPage: true });
  console.log("Mobil horizontaler Overflow:", await m.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  console.log("JS-Fehler:", errors.length ? errors : "keine");
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await globalThis.__page?.screenshot({ path: "screenshots/p-error.png" }).catch(() => undefined);
  process.exit(1);
});
