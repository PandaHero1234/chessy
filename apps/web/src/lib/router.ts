import { useEffect, useState } from "react";

/** Minimaler History-Router: "/", "/game/:id", "/lobby", "/chesscom", "/developers", "/settings". */
export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

export function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}

export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(e.currentTarget.getAttribute("href")!);
}
