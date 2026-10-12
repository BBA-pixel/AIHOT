// Site-wide toast stack (Sonner-style): drop in, stack, Presence enter/leave. No animation library.
import { useEffect, useRef, useState } from "react";
import { Presence } from "./Presence";

type Tone = "ok" | "error" | "info";
interface Item {
  id: number;
  text: string;
  tone: Tone;
  show: boolean;
}

let listeners: Array<(items: Item[]) => void> = [];
let items: Item[] = [];
let seq = 0;

function emit() {
  for (const l of listeners) l([...items]);
}

/** Push a toast; keeps at most four. Prefer short phrases ("链接已复制"). */
export function toast(text: string, tone: Tone = "ok") {
  if (typeof window === "undefined") return;
  const id = ++seq;
  items = [...items, { id, text, tone, show: true }].slice(-4);
  emit();
  const hold = tone === "error" ? 4500 : 2400;
  window.setTimeout(() => {
    items = items.map((i) => (i.id === id ? { ...i, show: false } : i));
    emit();
    window.setTimeout(() => {
      items = items.filter((i) => i.id !== id);
      emit();
    }, 200);
  }, hold);
}

export function Toaster() {
  const [list, setList] = useState<Item[]>([]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const on = (next: Item[]) => {
      if (mounted.current) setList(next);
    };
    listeners.push(on);
    on(items);
    return () => {
      mounted.current = false;
      listeners = listeners.filter((l) => l !== on);
    };
  }, []);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-8"
      role="status"
      aria-live="polite"
    >
      {list.map((t) => {
        const tone =
          t.tone === "error"
            ? "bg-hot text-white"
            : t.tone === "info"
              ? "border border-line-strong bg-surface text-ink"
              : "bg-ink text-bg";
        return (
          <Presence key={t.id} show={t.show} enter="anim-notice-in" exit="anim-fade-out" duration={180}>
            <div className={`pointer-events-auto max-w-sm rounded-full px-4 py-2 text-[13px] shadow-[var(--shadow-pop)] ${tone}`}>{t.text}</div>
          </Presence>
        );
      })}
    </div>
  );
}
