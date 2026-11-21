// Optionales Login im Browser (Handy-Ansicht, zwei getrennte Geräte):
// Gast löst ein Puzzle → legt ein Konto an (Fortschritt bleibt) → zweites Gerät meldet sich an und sieht denselben Stand
// → Abmelden betrifft nur dieses Gerät. Läuft gegen den Server; gegen die Pages-Demo wird nur der Hinweis geprüft.
//   node e2e/account.cjs [baseUrl]
const { chromium } = require("playwright");
const { byId } = require("./puzzleData.cjs");
const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const STATIC = base.includes("/chessy");
let failures = 0;
const ok = (cond, label, detail = "") => {
  if (!cond) failures++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail && !cond ? ` → ${detail}` : ""}`);
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const device = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    return page;
  };
  const chip = (page) => page.locator(".account-chip .account-name").textContent();

  if (STATIC) {
    const page = await device();
    await page.goto(base + "/settings");
    await page.waitForSelector("#account");
    ok(/Chessy-Server/.test(await page.textContent("#account")), "Pages-Demo: Hinweis, dass Konten den Server brauchen");
    ok((await page.locator("#account input[type=password]").count()) === 0, "Pages-Demo: keine Anmeldeformulare");
    ok(errors.length === 0, "keine JS-Fehler", errors.join(" | "));
    await browser.close();
    console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : "\nAlle Konto-Prüfungen bestanden");
    process.exit(failures ? 1 : 0);
  }

  const name = `Test_${Date.now().toString(36).slice(-6)}`;
  const pw = "sicheres-pw-123";

  // ---------- Gerät A: als Gast ein Puzzle lösen
  const a = await device();
  await a.goto(base + "/puzzles");
  await a.waitForSelector("[data-phase='play']");
  const guestName = await chip(a);
  ok(/^Gast-/.test(guestName), "Start als Gast", guestName);
  ok(await a.locator(".account-chip").isVisible(), "Kopfleiste zeigt den Gast");
  const p = byId.get(await a.getAttribute("[data-puzzle-id]", "data-puzzle-id"));
  for (let i = 1; i < p.moves.length; i += 2) {
    await a.waitForSelector("[data-phase='play']");
    await a.locator(`.puzzle-stage [data-square="${p.moves[i].slice(0, 2)}"]`).tap();
    await a.locator(`.puzzle-stage [data-square="${p.moves[i].slice(2, 4)}"]`).tap();
    if (p.moves[i][4]) await a.locator(".promo-piece").nth("qnrb".indexOf(p.moves[i][4])).tap();
  }
  await a.waitForSelector("[data-phase='solved']");
  await a.waitForTimeout(400);
  const ratingA = (await a.textContent(".ps-rating")).match(/^\d+/)[0];

  // ---------- Gerät A: Konto anlegen
  await a.locator(".account-chip").tap();
  await a.waitForSelector("#account");
  ok(/1 gelöste[s]? Puzzle/.test(await a.textContent("#account")), "Konto anlegen: Hinweis, dass der Fortschritt bleibt");
  await a.fill("#acc-username", name);
  await a.fill("#acc-pw", pw);
  await a.fill("#acc-pw2", "anderes-pw-123");
  await a.locator("#account button.btn.primary").tap();
  await a.waitForSelector(".form-error");
  ok(/stimmen nicht/.test(await a.textContent(".form-error")), "Konto anlegen: unterschiedliche Passwörter werden erkannt");
  await a.fill("#acc-pw2", pw);
  await a.locator("#acc-pw + .pw-toggle").tap();
  ok((await a.getAttribute("#acc-pw", "type")) === "text", "Passwort lässt sich einblenden");
  await a.locator("#account button.btn.primary").tap();
  await a.waitForSelector("text=Angemeldet als");
  ok((await chip(a)) === name, "Konto angelegt: Kopfleiste zeigt den neuen Namen", await chip(a));
  await a.screenshot({ path: "screenshots/account-1-angemeldet.png" });
  await a.reload();
  await a.waitForSelector("text=Angemeldet als");
  ok(true, "Nach dem Neuladen weiter angemeldet");

  // ---------- Gerät B: falsches Passwort, dann anmelden
  const b = await device();
  await b.goto(base + "/settings");
  await b.waitForSelector("#account");
  await b.locator(".account-tabs button", { hasText: "Anmelden" }).tap();
  await b.fill("#acc-username", name.toLowerCase());
  await b.fill("#acc-login-pw", "falsches-pw-1");
  await b.locator("#account button.btn.primary").tap();
  await b.waitForSelector(".form-error");
  ok(/falsch/.test(await b.textContent(".form-error")), "Falsches Passwort: verständliche Meldung");
  await b.fill("#acc-login-pw", pw);
  await b.locator("#account button.btn.primary").tap();
  await b.waitForSelector("text=Angemeldet als");
  ok((await chip(b)) === name, "Zweites Gerät: angemeldet (Groß-/Kleinschreibung egal)");
  await b.goto(base + "/puzzles");
  await b.waitForSelector(".ps-rating");
  await b.waitForTimeout(400);
  ok((await b.textContent(".ps-rating")).startsWith(ratingA), "Zweites Gerät: gleiches Puzzle-Rating wie Gerät A", `${await b.textContent(".ps-rating")} vs ${ratingA}`);
  await b.locator(".sheet-btn").tap();
  await b.waitForSelector(".sheet.open");
  ok(/1\/1 gelöst/.test(await b.textContent(".sheet.open .rating-card")), "Zweites Gerät: Verlauf vom Gast-Puzzle ist da");

  // ---------- Gerät B abmelden, Gerät A bleibt angemeldet
  await b.goto(base + "/settings");
  await b.waitForSelector("text=Angemeldet als");
  await b.screenshot({ path: "screenshots/account-2-geraet-b.png" });
  await b.locator("#account button", { hasText: /^Abmelden$/ }).tap();
  await b.waitForSelector(".account-tabs");
  ok(/^Gast-/.test(await chip(b)), "Abmelden: Gerät B spielt wieder als neuer Gast", await chip(b));
  await a.reload();
  await a.waitForSelector("#account");
  ok((await a.textContent("#account")).includes("Angemeldet als"), "Gerät A bleibt angemeldet");

  // ---------- Passwort ändern auf A
  await a.locator("#account button", { hasText: "Passwort ändern" }).tap();
  await a.fill("#acc-old", pw);
  await a.fill("#acc-new", "neues-pw-4567");
  await a.fill("#acc-new2", "neues-pw-4567");
  await a.locator("#account button.btn.primary").tap();
  await a.waitForSelector(".toast >> text=Passwort geändert");
  ok(true, "Passwort ändern");

  // ---------- Layout am Handy
  const m = await a.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: innerWidth,
    font: Math.min(...[...document.querySelectorAll("#account input:not([hidden])")].map((i) => parseFloat(getComputedStyle(i).fontSize))),
    small: [...document.querySelectorAll("#account button, #account input:not([hidden])")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).length,
  }));
  ok(m.sw <= m.iw, "Konto-Bereich: kein seitliches Scrollen", `${m.sw}`);
  ok(m.font >= 16, "Konto-Bereich: Eingabefelder mit mindestens 16 px Schrift", `${m.font}px`);
  ok(m.small === 0, "Konto-Bereich: Tippziele mindestens 44 px");
  ok(errors.length === 0, "keine JS-Fehler", errors.join(" | "));

  await browser.close();
  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen` : "\nAlle Konto-Prüfungen bestanden");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
