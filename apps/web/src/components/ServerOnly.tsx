import { navigate } from "../lib/router.ts";

/** Hinweis in der statischen Demo für Funktionen, die den Chessy-Server brauchen. */
export function ServerOnly({ title }: { title: string }) {
  return (
    <div className="page narrow">
      <section className="glass card center">
        <div className="empty-icon">🌍</div>
        <h2>{title} braucht den Server</h2>
        <p className="muted">
          Diese Demo auf GitHub Pages läuft komplett im Browser: Spiel gegen den Computer, lokal zu zweit, Analyse und chess.com-Import. Für Online-Partien,
          Lobby und die Bot/Board-API startest du Chessy mit <code>npm install && npm run build && npm start</code>.
        </p>
        <button className="btn primary" onClick={() => navigate("/")}>
          Gegen den Computer spielen
        </button>
      </section>
    </div>
  );
}
