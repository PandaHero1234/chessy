import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Account, AccountEvent } from "@chessy/shared";
import { ensureAccount } from "./lib/api.ts";
import { live } from "./lib/live.ts";
import { currentPath, navigate, onLinkClick, usePath } from "./lib/router.ts";
import { STATIC, href, pieceUrl } from "./lib/paths.ts";
import { Home } from "./pages/Home.tsx";
import { GamePage } from "./pages/GamePage.tsx";
import { Lobby } from "./pages/Lobby.tsx";
import { ChessCom } from "./pages/ChessCom.tsx";
import { Developers } from "./pages/Developers.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { Puzzles } from "./pages/Puzzles.tsx";

const AccountCtx = createContext<Account | null>(null);
const SetAccountCtx = createContext<(a: Account) => void>(() => undefined);
const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export const useAccount = () => useContext(AccountCtx);
export const useSetAccount = () => useContext(SetAccountCtx);
export const useToast = () => useContext(ToastCtx);

const NAV = [
  ["/", "Spielen"],
  ["/puzzles", "Puzzles"],
  ["/lobby", "Lobby"],
  ["/chesscom", "chess.com"],
  ["/developers", "API"],
  ["/settings", "Einstellungen"],
] as const;

export function App() {
  const path = usePath();
  const [account, setAccount] = useState<Account | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Menü schließt sich bei jedem Seitenwechsel.
  useEffect(() => setMenuOpen(false), [path]);

  const toast = useCallback((msg: string) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  useEffect(() => {
    ensureAccount().then(
      (a) => {
        setAccount(a);
        live.connect();
      },
      () => setError(STATIC ? "Die Demo konnte nicht gestartet werden." : "Server nicht erreichbar. Läuft `npm run dev:server`?"),
    );
    return live.onStatus(setOnline);
  }, []);

  // Wird eine Partie gestartet (Lobby-Paarung, angenommene Einladung), direkt hinspringen.
  useEffect(
    () =>
      live.on("user", (msg) => {
        const e = msg as unknown as AccountEvent;
        if (e.type === "gameStart" && !currentPath().startsWith(`/game/${e.game.id}`)) {
          if (currentPath() === "/lobby" || currentPath() === "/") navigate(`/game/${e.game.id}`);
          else toast(`Partie gegen ${e.game.opponent} gestartet`);
        }
      }),
    [toast],
  );

  const gameMatch = /^\/game\/([\w-]+)/.exec(path);
  let page;
  if (gameMatch) page = <GamePage id={gameMatch[1]!} />;
  else if (path === "/puzzles" || path.startsWith("/puzzles/")) page = <Puzzles path={path} />;
  else if (path === "/lobby") page = <Lobby />;
  else if (path === "/chesscom") page = <ChessCom />;
  else if (path === "/developers") page = <Developers />;
  else if (path === "/settings") page = <SettingsPage />;
  else page = <Home />;
  const pageKind = gameMatch ? "game" : path.startsWith("/puzzles") ? "puzzles" : path === "/" ? "home" : "other";

  return (
    <AccountCtx.Provider value={account}>
      <SetAccountCtx.Provider value={setAccount}>
        <ToastCtx.Provider value={toast}>
          <header className="topbar">
            <a href={href("/")} onClick={onLinkClick} className="logo">
              <img src={pieceUrl("wN")} alt="" />
              <span>Chessy</span>
            </a>
            <nav className={menuOpen ? "open" : ""}>
              {NAV.map(([to, label]) => (
                <a key={to} href={href(to)} onClick={onLinkClick} className={(to === "/" ? path === "/" : path.startsWith(to)) ? "active" : ""}>
                  {label}
                </a>
              ))}
            </nav>
            <a
              className="account-chip"
              href={href("/settings")}
              onClick={onLinkClick}
              title={`${online ? "Verbunden" : "Verbindung getrennt"} · ${account?.kind === "user" ? "Angemeldet" : "Gast – Konto in den Einstellungen"}`}
            >
              <span className={`status-dot ${online ? "on" : "off"}`} />
              <span className="account-name">{account?.username ?? "…"}</span>
              {!STATIC && account?.kind === "guest" && <span className="chip-login">Anmelden</span>}
            </a>
            <button className="menu-btn" aria-label="Menü" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              {menuOpen ? "✕" : "☰"}
            </button>
          </header>
          {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}
          <main data-page={pageKind}>{error ? <div className="page narrow center error-box">{error}</div> : page}</main>
          <footer className="footer muted small">
            Chessy · Engine: Stockfish (GPLv3) · Figuren: Colin M.L. Burnett (GPLv2+) ·{" "}
            {STATIC ? <a href="https://github.com/PandaHero1234/chessy">Quellcode</a> : <a href="/docs">API-Doku</a>}
          </footer>
          <div className="toasts">
            {toasts.map((t) => (
              <div className="toast" key={t.id}>
                {t.msg}
              </div>
            ))}
          </div>
        </ToastCtx.Provider>
      </SetAccountCtx.Provider>
    </AccountCtx.Provider>
  );
}
