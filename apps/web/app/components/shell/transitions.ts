// Phones: a page opened one level deeper slides in from the right. Desktop: a short fade (View
// Transitions). Links opt in with React Router's `viewTransition`; this marks <html data-vt> for
// app.css. Unsupported browsers keep an instant change. The browser's own back keeps its animation.
import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router";
import { isPhone } from "./screens";

let goingBack = false;

/** Called just before navigating back from the app's own controls (the bar's back button, a tab tapped deeper in). */
export function markBack() {
  goingBack = true;
}

/** In the root: marks the direction of each page change while it is committed, before the transition animates. */
export function usePageTransition() {
  const { key } = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => {
    document.documentElement.dataset.vt = isPhone()
      ? goingBack
        ? "back"
        : type === "POP"
          ? "none"
          : "push"
      : goingBack || type === "POP"
        ? "fade"
        : "fade";
    goingBack = false;
  }, [key]);
}
