import { useEffect, useRef } from "react";
import { sanDe } from "../lib/notation.ts";

export function MoveList({ san, viewPly, onSelect }: { san: string[]; viewPly: number; onSelect: (ply: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Nur die Liste selbst scrollen (scrollIntoView würde am Handy die ganze Seite bewegen).
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>(".mv.current");
    if (box && el) box.scrollTop = el.offsetTop - box.offsetTop - (box.clientHeight - el.offsetHeight) / 2;
  }, [viewPly, san.length]);
  const rows = [];
  for (let i = 0; i < san.length; i += 2) {
    rows.push(
      <div className="mv-row" key={i}>
        <span className="mv-num">{i / 2 + 1}.</span>
        <button className={`mv ${viewPly === i + 1 ? "current" : ""}`} onClick={() => onSelect(i + 1)}>
          {sanDe(san[i]!)}
        </button>
        {san[i + 1] !== undefined ? (
          <button className={`mv ${viewPly === i + 2 ? "current" : ""}`} onClick={() => onSelect(i + 2)}>
            {sanDe(san[i + 1]!)}
          </button>
        ) : (
          <span />
        )}
      </div>,
    );
  }
  return (
    <div className="movelist" ref={ref}>
      {rows.length ? rows : <div className="muted center pad">Noch keine Züge</div>}
    </div>
  );
}
