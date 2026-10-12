import type { MouseEvent as ReactMouseEvent } from "react";

/** Dark-theme card cursor spotlight: writes --spot-x/y on the card. No-op without hover + fine pointer. */
export function onCardSpotlightMove(e: ReactMouseEvent<HTMLElement>) {
  if (typeof window === "undefined") return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  if (document.documentElement.dataset.theme !== "dark") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--spot-x", `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty("--spot-y", `${((e.clientY - r.top) / r.height) * 100}%`);
}
