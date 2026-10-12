import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhoneBar } from "../../../apps/web/app/components/shell/PhoneBar";
import type { Screen } from "../../../apps/web/app/components/shell/screens";
import { pageMeta } from "../../../apps/web/app/lib/seo";
import { isAllowedAskHref, sanitizeAskMarkdown } from "../src/agent/citations.ts";

export const handle: Screen = { tab: "me", name: "AI 问答" };

export function meta() {
  return pageMeta({ title: "AI 问答", path: "/ask", description: "基于 GAMEHOT 站内只读工具的问答：精选、热点、入选与上榜依据。", noindex: true });
}

const EXAMPLES = [
  "最近有哪些值得看的游戏新闻？",
  "现在热榜上有什么？",
  "帮我找和《原神》相关的报道",
  "这篇资讯为什么能进精选？",
  "这个事件为什么上热点榜？",
];

const SESSION_KEY = "gamehot:ask:sessionId";

type Step = { stepId: string; tool: string; labelZh: string; status: "running" | "ok" | "fail"; summary?: string };
type Evidence = { id: number; title?: string | null; siteUrl?: string | null; originalUrl?: string | null; sourceName?: string | null; unavailable?: boolean };
type Bubble =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; steps: Step[]; evidence: Evidence[]; status: string; streaming?: boolean; contentInvalidated?: boolean };

/** Prefer crypto.randomUUID; fall back when the page is not a secure context (plain http://IP). */
function newId() {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // insecure context or implementation quirk
    }
  }
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last resort (non-crypto); still UUID-shaped for the API's uuid check.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const n = (Math.random() * 16) | 0;
    const v = ch === "x" ? n : (n & 0x3) | 0x8;
    return v.toString(16);
  });
}

function useSessionId() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) setSessionId(existing);
  }, []);
  const ensure = useCallback(async () => {
    if (sessionId) return sessionId;
    const res = await fetch("/api/ask/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `创建会话失败（${res.status}）`);
    }
    const data = await res.json();
    if (!data.sessionId) throw new Error("创建会话失败");
    localStorage.setItem(SESSION_KEY, data.sessionId);
    setSessionId(data.sessionId);
    return data.sessionId as string;
  }, [sessionId]);
  const reset = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setSessionId(null);
  }, []);
  return { sessionId, ensure, reset };
}

/** Render answer text safely: no remote images/iframes; only evidence URLs are clickable. */
function SafeAnswer({ text, evidence, streaming }: { text: string; evidence: Evidence[]; streaming?: boolean }) {
  const allowed = useMemo(() => {
    const s = new Set<string>();
    for (const e of evidence) {
      if (e.siteUrl) s.add(e.siteUrl);
      if (e.originalUrl) s.add(e.originalUrl);
    }
    return s;
  }, [evidence]);
  const safe = useMemo(() => sanitizeAskMarkdown(text, allowed), [text, allowed]);
  // Streaming: keep as plain-ish text with soft breaks; still unlink unregistered.
  if (streaming) {
    return <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">{safe}<span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[2px] animate-pulse bg-accent/70" aria-hidden /></div>;
  }
  // Simple paragraph split; links only when allowlisted.
  const parts = safe.split(/(\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s]+)/g);
  return (
    <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">
      {parts.map((p, i) => {
        const md = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
        if (md) {
          const href = md[2]!;
          if (isAllowedAskHref(href, allowed)) {
            return <a key={i} href={href} className="text-accent underline decoration-accent/40 underline-offset-[3px] transition-colors hover:decoration-accent" target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">{md[1]}</a>;
          }
          return <span key={i}>{md[1]}</span>;
        }
        if (/^https?:\/\//.test(p)) {
          if (isAllowedAskHref(p, allowed)) {
            return <a key={i} href={p} className="text-accent underline decoration-accent/40 underline-offset-[3px] transition-colors hover:decoration-accent" target="_blank" rel="noopener noreferrer">{p}</a>;
          }
          return <span key={i}>{p}</span>;
        }
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}

function StepStatusMark({ status }: { status: Step["status"] }) {
  if (status === "running") {
    return <span className="mt-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />;
  }
  if (status === "ok") {
    return <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ok" aria-hidden />;
  }
  return <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-hot" aria-hidden />;
}

function ToolSteps({ steps }: { steps: Step[] }) {
  const running = steps.some((s) => s.status === "running");
  const ok = steps.filter((s) => s.status === "ok").length;
  const label = running ? `查阅中 · ${ok}/${steps.length}` : `查阅步骤 · ${steps.length}`;
  return (
    <details className="group mb-3 rounded-control border border-line-soft bg-bg-sunk/60 open:bg-bg-sunk">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12.5px] tracking-wide text-ink-3 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="font-medium text-ink-2">{label}</span>
        <span className="ml-auto text-[11px] text-ink-4 transition-transform group-open:rotate-180" aria-hidden>▾</span>
      </summary>
      <ol className="space-y-2 border-t border-line-soft px-3 py-2.5">
        {steps.map((s) => (
          <li key={s.stepId} className="flex gap-2.5 text-[12.5px] leading-5 text-ink-3">
            <StepStatusMark status={s.status} />
            <div className="min-w-0">
              <div className="text-ink-2">
                {s.labelZh}
                <span className="ml-1.5 text-ink-4">
                  {s.status === "running" ? "执行中" : s.status === "ok" ? "完成" : "失败"}
                </span>
              </div>
              {s.summary ? <p className="mt-0.5 text-ink-4">{s.summary}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Citations({ evidence }: { evidence: Evidence[] }) {
  return (
    <aside className="mt-4 border-t border-line-soft pt-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="font-display text-[13px] font-semibold tracking-wide text-ink-2">来源</span>
        <span className="text-[11px] tabular-nums text-ink-4">{evidence.length}</span>
      </div>
      <ol className="space-y-2">
        {evidence.map((e) => (
          <li key={e.id} className="flex gap-2.5 text-[13px] leading-5">
            <span className="w-5 shrink-0 tabular-nums text-accent">{String(e.id).padStart(2, "0")}</span>
            <div className="min-w-0 text-ink-2">
              {e.unavailable ? (
                <span className="text-ink-4">来源已不可用</span>
              ) : (
                <>
                  <span className="text-ink">{e.title ?? "证据"}</span>
                  {e.sourceName ? <span className="ml-1.5 text-[12px] text-ink-4">{e.sourceName}</span> : null}
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
                    {!e.unavailable && e.siteUrl && isAllowedAskHref(e.siteUrl, new Set([e.siteUrl])) && (
                      <a className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent" href={e.siteUrl}>站内</a>
                    )}
                    {!e.unavailable && e.originalUrl && (
                      <a className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent" href={e.originalUrl} target="_blank" rel="noopener noreferrer">原文</a>
                    )}
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="mb-6 rounded-card border border-line bg-surface/70 px-5 py-6 sm:px-7 sm:py-8">
      <p className="font-display text-[17px] font-semibold tracking-wide text-ink">从一则站内线索问起</p>
      <p className="mt-2 max-w-xl text-[13.5px] leading-6 text-ink-3">
        回答只依据 GAMEHOT 公开资料：近期精选、搜索、热点与入选／上榜依据。不搜全网、不做攻略；打开本页不会触发模型调用。
      </p>
      <ul className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {EXAMPLES.map((q, i) => (
          <li key={q}>
            <button
              type="button"
              className="group flex w-full items-start gap-2.5 rounded-control border border-line-soft bg-bg-elevated/80 px-3.5 py-2.5 text-left transition-colors hover:border-line hover:bg-surface-hover sm:w-auto"
              onClick={() => onPick(q)}
            >
              <span className="mt-0.5 tabular-nums text-[11px] text-accent/80">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-[13px] leading-5 text-ink-2 group-hover:text-ink">{q}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AskPage() {
  const { sessionId, ensure, reset } = useSessionId();
  const [input, setInput] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "streaming_answer">("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const cursorRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bubbles, status]);

  const stopSse = () => {
    esRef.current?.close();
    esRef.current = null;
  };

  const applySnapshot = useCallback(async (id: string) => {
    const res = await fetch(`/api/ask/tasks/${id}`);
    if (!res.ok) return null;
    const snap = await res.json();
    cursorRef.current = snap.snapshotSeq ?? 0;
    const steps: Step[] = [];
    for (const s of snap.steps ?? []) {
      const p = s.payload ?? {};
      if (s.type === "step_start") steps.push({ stepId: p.stepId, tool: p.tool, labelZh: p.labelZh, status: "running" });
      if (s.type === "step_end") {
        const cur = steps.find((x) => x.stepId === p.stepId);
        if (cur) {
          cur.status = p.ok ? "ok" : "fail";
          cur.summary = p.summary;
        }
      }
    }
    const text = snap.contentInvalidated
      ? "相关来源已不可用，原回答不再展示"
      : (snap.finalAnswer ?? snap.draftAnswer ?? "");
    setBubbles((prev) => {
      // Keep last user; replace open assistant
      const users = prev.filter((b) => b.role === "user");
      const done = prev.filter((b) => b.role === "assistant" && (b.status === "completed" || b.status === "completed_degraded" || b.status === "failed" || b.status === "cancelled" || b.status === "limit_reached"));
      return [
        ...done.length || users.length ? [...users.slice(0, -1), ...done, users.at(-1)!].filter(Boolean) : users,
        {
          role: "assistant",
          text: typeof text === "string" ? text : "相关来源已不可用，原回答不再展示",
          steps,
          evidence: snap.evidence ?? [],
          status: snap.status,
          streaming: snap.status === "running",
          contentInvalidated: !!snap.contentInvalidated,
        },
      ];
    });
    if (snap.status === "running" || snap.status === "queued") setStatus(snap.status === "running" ? "running" : "running");
    else setStatus("idle");
    return snap;
  }, []);

  const subscribe = useCallback((id: string, fromSeq: number) => {
    stopSse();
    cursorRef.current = fromSeq;
    const es = new EventSource(`/api/ask/tasks/${id}/events?after=${encodeURIComponent(String(fromSeq))}`);
    esRef.current = es;

    const onAny = (type: string) => (ev: MessageEvent) => {
      const seq = Number(ev.lastEventId || 0);
      if (seq && seq <= cursorRef.current) return;
      if (seq) cursorRef.current = seq;
      let data: { payload?: Record<string, unknown>; type?: string };
      try { data = JSON.parse(ev.data); } catch { return; }
      const payload = data.payload ?? {};
      setBubbles((prev) => {
        const copy = [...prev];
        let assist = copy[copy.length - 1];
        if (!assist || assist.role !== "assistant") return prev;
        assist = { ...assist, steps: [...assist.steps], evidence: [...assist.evidence] };
        copy[copy.length - 1] = assist;
        if (type === "answer_delta") {
          assist.text += String(payload.text ?? "");
          assist.streaming = true;
          setStatus("streaming_answer");
        }
        if (type === "answer_done") {
          assist.text = String(payload.text ?? assist.text);
          assist.streaming = false;
        }
        if (type === "step_start") {
          assist.steps.push({ stepId: String(payload.stepId), tool: String(payload.tool), labelZh: String(payload.labelZh ?? payload.tool), status: "running" });
        }
        if (type === "step_end") {
          const s = assist.steps.find((x) => x.stepId === payload.stepId);
          if (s) {
            s.status = payload.ok ? "ok" : "fail";
            s.summary = String(payload.summary ?? "");
          }
        }
        if (type === "evidence") {
          const items = (payload.items as Evidence[] | undefined) ?? [];
          assist.evidence = [...assist.evidence, ...items];
        }
        if (type === "task_status") {
          assist.status = String(payload.status ?? assist.status);
          if (["completed", "completed_degraded", "failed", "cancelled", "limit_reached"].includes(assist.status)) {
            assist.streaming = false;
            setStatus("idle");
          }
        }
        if (type === "error") setError(String(payload.message ?? "出错了"));
        if (payload.unavailable) {
          assist.text = "相关来源已不可用，原回答不再展示";
          assist.contentInvalidated = true;
          assist.streaming = false;
        }
        return copy;
      });
    };

    for (const t of ["answer_delta", "answer_done", "step_start", "step_end", "evidence", "task_status", "error", "limit", "citation_check"]) {
      es.addEventListener(t, onAny(t));
    }
    es.onerror = () => {
      // Browser will retry; Last-Event-ID continues from last id. Do not cancel worker.
    };
  }, []);

  // Refresh restore
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sid = localStorage.getItem(SESSION_KEY);
      if (!sid) return;
      const res = await fetch(`/api/ask/sessions/${sid}`);
      if (!res.ok) {
        localStorage.removeItem(SESSION_KEY);
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      const msgs: Bubble[] = [];
      for (const m of data.messages ?? []) {
        if (m.role === "user") msgs.push({ role: "user", text: m.content });
        else if (m.role === "assistant") msgs.push({ role: "assistant", text: m.content, steps: [], evidence: [], status: "completed" });
      }
      setBubbles(msgs);
      const running = (data.recentTasks ?? []).find((t: { status: string }) => t.status === "queued" || t.status === "running");
      if (running) {
        setTaskId(running.id);
        const snap = await applySnapshot(running.id);
        if (snap) subscribe(running.id, snap.snapshotSeq ?? 0);
      }
    })();
    return () => { cancelled = true; stopSse(); };
  }, [applySnapshot, subscribe]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || status === "running" || status === "streaming_answer") return;
    setError(null);
    setInput("");
    setBubbles((b) => [...b, { role: "user", text: message }, { role: "assistant", text: "", steps: [], evidence: [], status: "queued", streaming: true }]);
    setStatus("running");
    try {
      const sid = await ensure();
      const res = await fetch(`/api/ask/sessions/${sid}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, clientRequestId: newId() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.detail ?? "发送失败");
        setStatus("idle");
        return;
      }
      const data = await res.json();
      setTaskId(data.taskId);
      cursorRef.current = 0;
      subscribe(data.taskId, 0);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "网络错误");
      setStatus("idle");
    }
  };

  const stop = async () => {
    if (!taskId) return;
    await fetch(`/api/ask/tasks/${taskId}/cancel`, { method: "POST" });
  };

  const newChat = () => {
    if (status === "running" || status === "streaming_answer") {
      if (!confirm("当前有生成中的回答，确定停止并开新对话？")) return;
      void stop();
    }
    stopSse();
    reset();
    setBubbles([]);
    setTaskId(null);
    setStatus("idle");
    setError(null);
  };

  const busy = status === "running" || status === "streaming_answer";

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[var(--page-max-reading)] flex-col pb-10">
      <PhoneBar title="AI 问答" />
      <header className="border-b border-line-soft px-1 pb-5 pt-1">
        <p className="text-[11px] uppercase tracking-[0.14em] text-ink-4">Ask · 站内只读</p>
        <h1 className="mt-1.5 font-display text-[26px] font-semibold tracking-wide text-ink">AI 问答</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-6 text-ink-3">
          只依据 GAMEHOT 站内公开资料回答：近期精选、搜索、热点、事件进展，以及入选／上榜依据。不搜全网、不做攻略；打开本页不触发模型调用。
        </p>
      </header>

      <div className="mt-5 flex flex-1 flex-col">
        {bubbles.length === 0 && <EmptyState onPick={(q) => setInput(q)} />}

        <div className="flex flex-col gap-5">
          {bubbles.map((b, i) => (
            b.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[min(90%,36rem)] rounded-card border border-accent/20 bg-accent-muted px-4 py-3 text-[15px] leading-6 text-ink shadow-[0_1px_0_var(--line-soft)]">
                  {b.text}
                </div>
              </div>
            ) : (
              <div key={i} className="w-full max-w-[min(95%,42rem)] rounded-card border border-line bg-surface px-4 py-3.5 sm:px-5 sm:py-4">
                {b.steps.length > 0 && <ToolSteps steps={b.steps} />}
                {b.contentInvalidated ? (
                  <p className="text-[15px] leading-7 text-ink-3">相关来源已不可用，原回答不再展示</p>
                ) : b.text ? (
                  <SafeAnswer text={b.text} evidence={b.evidence} streaming={b.streaming} />
                ) : (
                  <p className="flex items-center gap-2 text-[13.5px] text-ink-4">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
                    {b.streaming ? "正在整理站内线索…" : "…"}
                  </p>
                )}
                {b.evidence.length > 0 && !b.contentInvalidated && <Citations evidence={b.evidence} />}
                {b.status === "completed_degraded" && <p className="mt-3 text-[12px] text-amber-ink">引用校验未完全通过，已降级展示。</p>}
                {b.status === "cancelled" && <p className="mt-3 text-[12px] text-ink-4">已停止</p>}
                {b.status === "limit_reached" && <p className="mt-3 text-[12px] text-ink-4">已达调用上限</p>}
                {b.status === "failed" && <p className="mt-3 text-[12px] text-hot">生成失败</p>}
              </div>
            )
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && <p className="mt-3 text-[13px] text-hot">{error}</p>}

      <div className="sticky bottom-0 z-10 mt-6 -mx-1 border-t border-line bg-bg/95 px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
        <div className="rounded-card border border-line bg-field shadow-[0_1px_0_var(--line-soft)] focus-within:border-accent/50 focus-within:bg-surface">
          <textarea
            className="min-h-[52px] w-full resize-none bg-transparent px-3.5 py-3 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-4 disabled:opacity-60"
            rows={2}
            maxLength={2000}
            placeholder="问站内资讯、热点或入选／上榜依据…"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-2.5 py-2">
            <button type="button" className="inline-flex h-9 items-center justify-center rounded-full bg-accent px-4 text-[13.5px] font-medium text-accent-contrast transition-colors hover:bg-accent-ink disabled:opacity-45" disabled={busy || !input.trim()} onClick={() => void send(input)}>发送</button>
            <button type="button" className="inline-flex h-9 items-center justify-center rounded-full border border-line-strong bg-surface px-3.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:border-ink-4 hover:text-ink disabled:opacity-45" disabled={!busy} onClick={() => void stop()}>停止</button>
            <button type="button" className="inline-flex h-9 items-center justify-center rounded-full border border-line-strong bg-surface px-3.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:border-ink-4 hover:text-ink" onClick={newChat}>新对话</button>
            <span className="ml-auto hidden text-[11px] text-ink-4 sm:inline">Enter 发送 · Shift+Enter 换行</span>
          </div>
        </div>
      </div>
    </div>
  );
}
