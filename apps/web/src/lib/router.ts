import { useEffect, useState } from "react";
import { href, stripBase } from "./paths.ts";

/** Minimaler History-Router: "/", "/game/:id", "/lobby", "/chesscom", "/developers", "/settings". */
export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", href(path));
  else history.pushState(null, "", href(path));
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

export const currentPath = () => stripBase(location.pathname);

export function usePath() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}

export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(stripBase(e.currentTarget.pathname));
}

/** GitHub Pages leitet unbekannte Pfade auf 404.html um; die App übernimmt den Pfad von dort. */
export { href };
