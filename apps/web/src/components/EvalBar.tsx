import type { AnalysisResult, Color } from "@chessy/shared";

/** Bewertungsbalken (Sicht Weiß), skaliert über eine Sigmoid-Kurve. */
export function EvalBar({ analysis, orientation }: { analysis: AnalysisResult | null; orientation: Color }) {
  let pct = 50;
  let label = "0.0";
  if (analysis) {
    if ("mate" in analysis.eval) {
      pct = analysis.eval.mate > 0 ? 100 : 0;
      label = `M${Math.abs(analysis.eval.mate)}`;
    } else {
      const cp = analysis.eval.cp;
      pct = 100 / (1 + Math.exp(-0.004 * cp));
      label = `${cp > 0 ? "+" : ""}${(cp / 100).toFixed(1)}`;
    }
  }
  const whiteBottom = orientation === "white";
  return (
    <div className={`evalbar ${whiteBottom ? "" : "flipped"}`} title={`Bewertung ${label}`}>
      <div className="evalbar-white" style={{ height: `${pct}%` }} />
      <span className={`evalbar-label ${pct >= 50 ? "on-white" : "on-black"}`}>{label}</span>
    </div>
  );
}
