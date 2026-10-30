import { useEffect, useRef } from "react";

export function MoveList({ san, viewPly, onSelect }: { san: string[]; viewPly: number; onSelect: (ply: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector(".mv.current");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [viewPly, san.length]);
  const rows = [];
  for (let i = 0; i < san.length; i += 2) {
    rows.push(
      <div className="mv-row" key={i}>
        <span className="mv-num">{i / 2 + 1}.</span>
        <button className={`mv ${viewPly === i + 1 ? "current" : ""}`} onClick={() => onSelect(i + 1)}>
          {san[i]}
        </button>
        {san[i + 1] !== undefined ? (
          <button className={`mv ${viewPly === i + 2 ? "current" : ""}`} onClick={() => onSelect(i + 2)}>
            {san[i + 1]}
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
