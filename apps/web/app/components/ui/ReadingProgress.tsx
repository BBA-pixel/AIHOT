import { useEffect, useState } from "react";

/** A 2px accent bar at the top that tracks how far the reader has scrolled through the document. */
export function ReadingProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const max = el.scrollHeight - window.innerHeight;
      setP(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return <div className={`reading-progress ${p > 0.01 && p < 0.995 ? "is-on" : ""}`} style={{ transform: `scaleX(${p})` }} aria-hidden="true" />;
}
