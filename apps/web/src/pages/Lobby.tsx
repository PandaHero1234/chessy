import { useEffect, useState } from "react";
import type { Seek } from "@chessy/shared";
import { describeTimeControl, parseTimeControl } from "@chessy/shared";
import { TimeControlPicker } from "../components/TimeControlPicker.tsx";
import { api } from "../lib/api.ts";
import { live } from "../lib/live.ts";
import { navigate } from "../lib/router.ts";
import { useAccount, useToast } from "../App.tsx";

export function Lobby() {
  const account = useAccount();
  const toast = useToast();
  const [seeks, setSeeks] = useState<Seek[]>([]);
  const [tc, setTc] = useState("300+3");

  useEffect(() => {
    api.seeks().then(setSeeks, () => undefined);
    const offLobby = live.subscribeLobby((msg) => {
      if (msg.type === "seekAdded") setSeeks((s) => [...s.filter((x) => x.id !== (msg.seek as Seek).id), msg.seek as Seek]);
      if (msg.type === "seekRemoved") setSeeks((s) => s.filter((x) => x.id !== msg.seek_id));
    });
    return offLobby;
  }, []);

  const mine = seeks.filter((s) => s.user_id === account?.id);
  const others = seeks.filter((s) => s.user_id !== account?.id);

  const seek = async (time: string) => {
    try {
      const r = await api.seek(time);
      if (r.game) navigate(`/game/${r.game.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="page lobby">
      <div className="lobby-grid">
        <section className="glass card">
          <h2>Offene Partien</h2>
          {mine.length > 0 && (
            <div className="my-seeks">
              {mine.map((s) => (
                <div className="seek-waiting" key={s.id}>
                  <div className="spinner small" />
                  <span>
                    Suche Gegner · <b>{describeTimeControl(parseTimeControl(s.time_control))}</b>
                  </span>
                  <button className="btn small ghost" onClick={() => api.cancelSeek(s.id).catch(() => undefined)}>
                    Abbrechen
                  </button>
                </div>
              ))}
            </div>
          )}
          {others.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">♟</div>
              <p className="muted">
                Gerade sucht niemand. Erstelle rechts ein Gesuch – oder öffne Chessy in einem zweiten Browserfenster und spiel gegen dich selbst.
              </p>
            </div>
          ) : (
            <table className="seek-table">
              <thead>
                <tr>
                  <th>Spieler</th>
                  <th>Zeit</th>
                  <th>Modus</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {others.map((s) => (
                  <tr key={s.id}>
                    <td>{s.username}</td>
                    <td>{describeTimeControl(parseTimeControl(s.time_control))}</td>
                    <td className="cap">{s.time_class}</td>
                    <td>
                      <button className="btn small primary" onClick={() => seek(s.time_control)}>
                        Spielen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="glass card">
          <h2>Gesuch erstellen</h2>
          <TimeControlPicker value={tc} onChange={setTc} />
          <button className="btn primary big full" onClick={() => seek(tc)} style={{ marginTop: 16 }}>
            Gegner suchen · {describeTimeControl(parseTimeControl(tc))}
          </button>
        </section>
      </div>
    </div>
  );
}
