// Handy-Test mit Prüfungen: Alles Wichtige ist ohne Scrollen sichtbar, Tipp/Lösung/Weiter funktionieren per Touch.
//   node e2e/mobile.cjs [baseUrl]     Standard: http://localhost:4000/chessy (Pages-Build), auch gegen den Server nutzbar
const { chromium } = require("playwright");
const puzzles = require("../packages/puzzles/data/puzzles.json");
const byId = new Map(puzzles.map((p) => [p.id, p]));
const base = (process.argv[2] || "http://localhost:4000/chessy").replace(/\/$/, "");
const SIZES = [
  { name: "390x664", width: 390, height: 664 },
  { name: "360x640", width: 360, height: 640 },
  { name: "375x553", width: 375, height: 553 }, // kleines iPhone mit eingeblendeten Browserleisten
];
let failures = 0;

async function run(size, browser) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    if (!localStorage.getItem("chessy.newGame")) localStorage.setItem("chessy.newGame", JSON.stringify({ mode: "ai", tc: "300+3", level: 1, color: "white" }));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ok = (cond, label, detail = "") => {
    if (!cond) failures++;
    console.log(`  ${cond ? "✓" : "✗"} ${label}${detail && !cond ? ` → ${detail}` : ""}`);
  };
  const shot = (n) => page.screenshot({ path: `screenshots/mobile-${size.name}-${n}.png` });

  /** Anteil (0–100) eines Elements, der zwischen Kopfleiste und unterer Leiste sichtbar ist. */
  const vis = async (sel, bar) => {
    const loc = page.locator(sel).first();
    if (!(await loc.count())) return -1;
    const r = await loc.boundingBox();
    if (!r) return -1;
    const top = (await page.locator(".topbar").boundingBox()).height;
    const barBox = bar ? await page.locator(bar).boundingBox() : null;
    // Elemente in der unteren Leiste selbst werden nicht von ihr verdeckt.
    const bottom = barBox && r.y < barBox.y ? barBox.y : size.height;
    const visible = Math.max(0, Math.min(r.y + r.height, bottom) - Math.max(r.y, top));
    const inX = r.x >= -1 && r.x + r.width <= size.width + 1;
    return inX ? Math.round((100 * visible) / Math.max(r.height, 1)) : 0;
  };
  const allVisible = async (label, sels, bar) => {
    for (const [name, sel] of Object.entries(sels)) {
      const v = await vis(sel, bar);
      ok(v === 100, `${label}: ${name} vollständig sichtbar`, `${v}%`);
    }
  };
  const noScroll = async (label, { allowLongPage = false } = {}) => {
    const m = await page.evaluate(() => ({ y: Math.round(scrollY), sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok(m.y === 0, `${label}: Seite steht oben`, `scrollY ${m.y}`);
    if (!allowLongPage) ok(m.sh <= m.ih + 1, `${label}: kein senkrechtes Scrollen nötig`, `${m.sh} > ${m.ih}`);
    ok(m.sw <= m.iw, `${label}: kein seitliches Scrollen`, `${m.sw} > ${m.iw}`);
  };
  const waitPlay = () => page.waitForSelector("[data-phase='play']", { timeout: 15000 });
  const tapSq = (scope, s) => page.locator(`${scope} [data-square="${s}"]`).tap();
  const curId = () => page.getAttribute("[data-puzzle-id]", "data-puzzle-id");
  const solve = async (p) => {
    for (let i = 1; i < p.moves.length; i += 2) {
      await waitPlay();
      await tapSq(".puzzle-stage", p.moves[i].slice(0, 2));
      await tapSq(".puzzle-stage", p.moves[i].slice(2, 4));
    }
  };
  const PUZZLE = { Statuszeile: ".puzzle-statusbar", Brett: ".puzzle-stage .board", Aktionsleiste: ".action-bar" };

  console.log(`\n=== ${size.name} ===`);

  // ---------- Puzzle: Start
  await page.goto(base + "/puzzles");
  await waitPlay();
  await page.waitForTimeout(300);
  await allVisible("Puzzle-Start", PUZZLE, ".action-bar");
  await noScroll("Puzzle-Start");
  const boardW = (await page.locator(".puzzle-stage .board").boundingBox()).width;
  ok(boardW >= 280, "Brett ist groß genug", `${Math.round(boardW)}px`);
  await shot("1-puzzle");

  // ---------- Tipp in zwei Stufen
  let p = byId.get(await curId());
  await page.locator(".action-bar button", { hasText: "Tipp" }).tap();
  await page.waitForSelector(".sq-mark-hint");
  ok((await vis(".sq-mark-hint", ".action-bar")) === 100, "Tipp: markierte Figur ist im Bild");
  ok((await page.$eval(".sq-mark-hint", (e) => e.parentElement.dataset.square)) === p.moves[1].slice(0, 2), "Tipp: richtige Figur markiert");
  // Die Markierung muss das ganze Feld füllen (früher schrumpfte sie zu einem Punkt unter der Figur).
  const hintBox = await page.locator(".sq-mark-hint").boundingBox();
  const sqBox = await page.locator(`.puzzle-stage [data-square="${p.moves[1].slice(0, 2)}"]`).boundingBox();
  ok(hintBox.width >= sqBox.width - 1 && hintBox.height >= sqBox.height - 1, "Tipp: ganzes Feld leuchtet auf", `${Math.round(hintBox.width)}×${Math.round(hintBox.height)} von ${Math.round(sqBox.width)}`);
  const hintColor = await page.$eval(".sq-mark-hint", (e) => getComputedStyle(e).backgroundColor);
  const [r, , b, alpha = 1] = hintColor.match(/[\d.]+/g).map(Number);
  ok(b > 200 && b > r && alpha > 0.6, "Tipp: Feld ist kräftig blau hervorgehoben", hintColor);
  await shot("2a-tipp-feld");
  await page.locator(".action-bar button", { hasText: "Zielfeld" }).tap();
  await page.waitForSelector(".arrow.hint", { state: "attached" });
  ok(true, "Tipp Stufe 2: Pfeil zum Zielfeld");
  await noScroll("nach Tipp");
  await shot("2-tipp");

  // ---------- Lösen: Ergebnis deutlich sichtbar, Weiter in Daumenhöhe
  await solve(p);
  await page.waitForSelector("[data-phase='solved']");
  await page.waitForSelector(".result-flash");
  ok((await vis(".result-flash", ".action-bar")) === 100, "Gelöst: Einblendung über dem Brett sichtbar");
  ok(/Gelöst/.test(await page.textContent(".puzzle-statusbar.good .ps-title")), "Gelöst: Statuszeile grün mit „Gelöst“");
  await allVisible("Gelöst", { ...PUZZLE, "Weiter-Button": ".next-btn", Zugliste: ".solution-moves" }, ".action-bar");
  ok((await page.locator(".sol-move").count()) === p.moves.length, "Gelöst: Zugliste zeigt alle Züge");
  await noScroll("Gelöst");
  await shot("3-geloest");
  const nb = await page.locator(".next-btn").boundingBox();
  ok(nb.y + nb.height > size.height - 90 && nb.height >= 44, "Weiter-Button liegt unten in Daumenhöhe", `y ${Math.round(nb.y)}`);

  // ---------- Weiter: neues Puzzle sofort im Bild
  await page.locator(".next-btn").tap();
  await page.waitForFunction((old) => document.querySelector("[data-puzzle-id]")?.getAttribute("data-puzzle-id") !== old, p.id);
  await waitPlay();
  await allVisible("nach Weiter", PUZZLE, ".action-bar");
  await noScroll("nach Weiter");

  // ---------- Lösung zeigen: Pfeil + Zugliste + Schritte
  p = byId.get(await curId());
  await page.locator(".action-bar button", { hasText: "Lösung" }).tap();
  await page.waitForSelector("[data-phase='failed']");
  await page.waitForSelector(".arrow.good", { state: "attached" });
  ok(true, "Lösung: grüner Pfeil zeigt den richtigen Zug");
  ok((await page.locator(".sol-move").count()) === p.moves.length, "Lösung: Zugliste vorhanden");
  await allVisible("Lösung", { ...PUZZLE, Zugliste: ".solution-moves" }, ".action-bar");
  const before = await page.locator(".sol-move.current").textContent();
  await page.locator(".step-btn").nth(1).tap();
  await page.waitForTimeout(200);
  ok((await page.locator(".sol-move.current").textContent()) !== before, "Lösung: Vor-Taste geht einen Zug weiter");
  await noScroll("Lösung");
  await shot("4-loesung");

  // ---------- Nochmal versuchen
  await page.locator(".action-bar button[aria-label='Nochmal versuchen']").tap();
  await waitPlay();
  ok((await curId()) === p.id, "Nochmal: dasselbe Puzzle startet neu");

  // ---------- Filter-Auszug
  await page.locator(".sheet-btn").tap();
  await page.waitForSelector(".sheet.open");
  await page.waitForTimeout(350);
  ok((await vis(".sheet.open .rating-card")) === 100, "Auszug: Rating sichtbar");
  await shot("5-auszug");
  await page.locator(".sheet.open .chip", { hasText: "Einsteiger" }).tap();
  await page.locator(".sheet-done").tap();
  await page.waitForFunction((old) => document.querySelector("[data-puzzle-id]")?.getAttribute("data-puzzle-id") !== old, p.id);
  await waitPlay();
  ok(byId.get(await curId()).rating < 1000, "Auszug: Stufe „Einsteiger“ wird angewendet");
  await page.waitForTimeout(350);
  await noScroll("nach Filter");
  await page.evaluate(() => localStorage.removeItem("chessy.puzzleFilter"));

  // ---------- Sturm
  await page.goto(base + "/puzzles/storm");
  await waitPlay();
  await allVisible("Sturm", { Uhr: ".storm-clock", Punkte: ".storm-score", Leben: ".strikes", Brett: ".puzzle-stage .board" });
  await noScroll("Sturm");
  const sp = byId.get(await curId());
  await solve(sp);
  await page.waitForFunction(() => document.querySelector(".storm-score")?.textContent === "1");
  ok(true, "Sturm: Lösen per Touch zählt");
  await shot("6-sturm");

  // ---------- Startseite
  await page.goto(base + "/");
  await page.waitForSelector(".quick-tile");
  await allVisible("Start", { "Schnellstart Computer": ".quick-tile:has-text('Computer')", "Schnellstart Puzzle": ".quick-tile:has-text('Puzzle')", "Spielen-Button": ".start-btn" });
  await shot("7-start");

  // ---------- Menü
  await page.locator(".menu-btn").tap();
  await page.waitForSelector(".topbar nav.open");
  ok((await vis(".topbar nav.open a:has-text('Einstellungen')")) >= 99 || (await page.locator(".topbar nav.open a:has-text('Einstellungen')").isVisible()), "Menü: alle Punkte erreichbar");
  await page.locator(".menu-btn").tap();

  // ---------- Partie über den Schnellstart
  await page.locator(".quick-tile:has-text('Computer')").tap();
  await page.waitForSelector(".game-page .board");
  await page.waitForTimeout(500);
  // Auf sehr kurzen Bildschirmen weicht die Zugleiste dem Brett; die Zugliste steht dann unter dem Brett.
  const GAME = { "Uhr oben": ".player-bar >> nth=0", Brett: ".game-page .board", "Uhr unten": ".player-bar >> nth=1", ...(size.height > 620 ? { Zugleiste: ".move-strip" } : {}), Aktionsleiste: ".game-bar" };
  await allVisible("Partie", GAME, ".game-bar");
  const gameBoardW = (await page.locator(".game-page .board").boundingBox()).width;
  ok(gameBoardW >= 280, "Partie: Brett ist groß genug", `${Math.round(gameBoardW)}px`);
  await noScroll("Partie", { allowLongPage: true }); // Chat und Partie-Infos liegen bewusst unter dem Brett
  await tapSq(".game-page .board-column", "e2");
  await tapSq(".game-page .board-column", "e4");
  await page.waitForFunction(() => document.querySelectorAll(".mvs").length >= 2, null, { timeout: 20000 });
  ok(/^1\.\s*e4$/.test((await page.locator(".mvs").first().textContent()).trim()), "Partie: Zugleiste zeigt den Zug");
  ok(true, "Partie: Zug per Touch, Computer antwortet");
  await page.waitForTimeout(600);
  await allVisible("Partie nach Zügen", GAME, ".game-bar");
  await shot("8-partie");
  await page.locator(".bar-btn", { hasText: "Aufgeben" }).tap();
  await page.locator(".bar-btn", { hasText: "Sicher?" }).tap();
  await page.waitForSelector(".modal");
  ok((await vis(".modal")) === 100, "Partie: Ergebnis-Fenster vollständig sichtbar");
  await shot("9-ergebnis");

  // ---------- Tippziele und Schriftgrößen
  await page.goto(base + "/puzzles");
  await waitPlay();
  const small = await page.evaluate(() =>
    [...document.querySelectorAll(".topbar button, .topbar a.logo, .puzzle-tabs a, .puzzle-statusbar button, .action-bar button")]
      .filter((e) => e.offsetParent)
      .map((e) => ({ t: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 16), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) }))
      .filter((x) => x.h < 44 || x.w < 44),
  );
  ok(small.length === 0, "Tippziele mindestens 44 px", small.map((x) => `${x.t} ${x.w}×${x.h}`).join(", "));
  await page.locator(".sheet-btn").tap();
  await page.waitForSelector(".sheet.open");
  const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".sheet select")).fontSize));
  ok(fs >= 16, "Eingabefelder mit mindestens 16 px Schrift", `${fs}px`);
  ok(errors.length === 0, "keine JS-Fehler", errors.join(" | "));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const size of SIZES) await run(size, browser);
  await browser.close();
  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : "\nAlle Handy-Prüfungen bestanden");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
