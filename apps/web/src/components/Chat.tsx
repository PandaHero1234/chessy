import { useEffect, useRef, useState } from "react";
import type { ChatLine } from "@chessy/shared";

export function Chat({ lines, onSend, disabled }: { lines: ChatLine[]; onSend: (t: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines.length]);
  return (
    <div className="chat">
      <div className="chat-lines" ref={ref}>
        {lines.length === 0 && <div className="muted small">Sag Hallo 👋</div>}
        {lines.map((l, i) => (
          <div key={i} className={`chat-line ${l.username === "System" ? "system" : ""}`}>
            <b>{l.username}</b> {l.text}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onSend(text.trim());
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nachricht…" maxLength={300} disabled={disabled} />
      </form>
    </div>
  );
}
