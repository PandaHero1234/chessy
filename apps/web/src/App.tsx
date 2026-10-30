import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Account, AccountEvent } from "@chessy/shared";
import { ensureAccount } from "./lib/api.ts";
import { live } from "./lib/live.ts";
import { navigate, onLinkClick, usePath } from "./lib/router.ts";
import { Home } from "./pages/Home.tsx";
import { GamePage } from "./pages/GamePage.tsx";
import { Lobby } from "./pages/Lobby.tsx";
import { ChessCom } from "./pages/ChessCom.tsx";
import { Developers } from "./pages/Developers.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";

const AccountCtx = createContext<Account | null>(null);
const SetAccountCtx = createContext<(a: Account) => void>(() => undefined);
const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export const useAccount = () => useContext(AccountCtx);
export const useSetAccount = () => useContext(SetAccountCtx);
export const useToast = () => useContext(ToastCtx);

const NAV = [
  ["/", "Spielen"],
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
      () => setError("Server nicht erreichbar. Läuft `npm run dev:server`?"),
    );
    return live.onStatus(setOnline);
  }, []);

  // Wird eine Partie gestartet (Lobby-Paarung, angenommene Einladung), direkt hinspringen.
  useEffect(
    () =>
      live.on("user", (msg) => {
        const e = msg as unknown as AccountEvent;
        if (e.type === "gameStart" && !location.pathname.startsWith(`/game/${e.game.id}`)) {
          if (location.pathname === "/lobby" || location.pathname === "/") navigate(`/game/${e.game.id}`);
          else toast(`Partie gegen ${e.game.opponent} gestartet`);
        }
      }),
    [toast],
  );

  const gameMatch = /^\/game\/([\w-]+)/.exec(path);
  let page;
  if (gameMatch) page = <GamePage id={gameMatch[1]!} />;
  else if (path === "/lobby") page = <Lobby />;
  else if (path === "/chesscom") page = <ChessCom />;
  else if (path === "/developers") page = <Developers />;
  else if (path === "/settings") page = <SettingsPage />;
  else page = <Home />;

  return (
    <AccountCtx.Provider value={account}>
      <SetAccountCtx.Provider value={setAccount}>
        <ToastCtx.Provider value={toast}>
          <header className="topbar">
            <a href="/" onClick={onLinkClick} className="logo">
              <img src="/pieces/cburnett/wN.svg" alt="" />
              <span>Chessy</span>
            </a>
            <nav>
              {NAV.map(([href, label]) => (
                <a key={href} href={href} onClick={onLinkClick} className={(href === "/" ? path === "/" : path.startsWith(href)) ? "active" : ""}>
                  {label}
                </a>
              ))}
            </nav>
            <div className="account-chip" title={online ? "Verbunden" : "Verbindung getrennt"}>
              <span className={`status-dot ${online ? "on" : "off"}`} />
              {account?.username ?? "…"}
            </div>
          </header>
          <main>{error ? <div className="page narrow center error-box">{error}</div> : page}</main>
          <footer className="footer muted small">
            Chessy · Engine: Stockfish (GPLv3) · Figuren: Colin M.L. Burnett (GPLv2+) · <a href="/docs">API-Doku</a>
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
