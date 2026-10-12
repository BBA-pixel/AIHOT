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

function newId() {
  return crypto.randomUUID();
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
    const data = await res.json();
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
    return <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">{safe}</div>;
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
            return <a key={i} href={href} className="text-accent underline underline-offset-2" target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">{md[1]}</a>;
          }
          return <span key={i}>{md[1]}</span>;
        }
        if (/^https?:\/\//.test(p)) {
          if (isAllowedAskHref(p, allowed)) {
            return <a key={i} href={p} className="text-accent underline underline-offset-2" target="_blank" rel="noopener noreferrer">{p}</a>;
          }
          return <span key={i}>{p}</span>;
        }
        return <span key={i}>{p}</span>;
      })}
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
      const withoutAssist = prev.filter((b) => b.role === "user" || (b.role === "assistant" && b.status === "completed"));
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
    } catch {
      setError("网络错误");
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
    <div className="mx-auto flex min-h-[70vh] max-w-[var(--page-max-reading)] flex-col pb-8">
      <PhoneBar title="AI 问答" />
      <header className="px-1 pb-4 pt-1">
        <h1 className="font-display text-[24px] font-semibold tracking-wide text-ink">AI 问答</h1>
        <p className="mt-2 text-[14px] leading-6 text-ink-3">
          只依据 GAMEHOT 站内公开资料回答：近期精选、搜索、热点、事件进展，以及入选／上榜依据。不搜全网、不做攻略，打开本页不触发模型调用。
        </p>
      </header>

      {bubbles.length === 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {EXAMPLES.map((q) => (
            <button key={q} type="button" className="rounded-full border border-line bg-bg-elevated px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink" onClick={() => setInput(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4">
        {bubbles.map((b, i) => (
          <div key={i} className={b.role === "user" ? "self-end max-w-[90%] rounded-card bg-accent-muted px-4 py-2.5 text-[15px] text-ink" : "self-start w-full max-w-[95%] rounded-card border border-line bg-surface px-4 py-3"}>
            {b.role === "user" ? b.text : (
              <>
                {b.steps.length > 0 && (
                  <details className="disclosure mb-2 rounded-control bg-bg-sunk px-3 py-2 text-[13px] text-ink-3">
                    <summary className="cursor-pointer select-none text-ink-2">步骤（{b.steps.length}）</summary>
                    <ul className="mt-1 space-y-1">
                      {b.steps.map((s) => (
                        <li key={s.stepId}>
                          {s.labelZh} · {s.status === "running" ? "执行中" : s.status === "ok" ? "成功" : "失败"}
                          {s.summary ? ` — ${s.summary}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {b.contentInvalidated ? (
                  <p className="text-[15px] text-ink-3">相关来源已不可用，原回答不再展示</p>
                ) : b.text ? (
                  <SafeAnswer text={b.text} evidence={b.evidence} streaming={b.streaming} />
                ) : (
                  <p className="text-[14px] text-ink-4">{b.streaming ? "生成中…" : "…"}</p>
                )}
                {b.evidence.length > 0 && !b.contentInvalidated && (
                  <div className="mt-3 border-t border-line-soft pt-2">
                    <div className="text-[12px] font-semibold text-ink-3">来源</div>
                    <ul className="mt-1 space-y-1 text-[13px]">
                      {b.evidence.map((e) => (
                        <li key={e.id} className="text-ink-2">
                          [{e.id}] {e.unavailable ? "来源已不可用" : (e.title ?? "证据")}
                          {!e.unavailable && e.siteUrl && isAllowedAskHref(e.siteUrl, new Set([e.siteUrl])) && (
                            <> · <a className="text-accent underline" href={e.siteUrl}>站内</a></>
                          )}
                          {!e.unavailable && e.originalUrl && (
                            <> · <a className="text-accent underline" href={e.originalUrl} target="_blank" rel="noopener noreferrer">原文</a></>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {b.status === "completed_degraded" && <p className="mt-2 text-[12px] text-amber-ink">引用校验未完全通过，已降级展示。</p>}
                {b.status === "cancelled" && <p className="mt-2 text-[12px] text-ink-4">已停止</p>}
                {b.status === "limit_reached" && <p className="mt-2 text-[12px] text-ink-4">已达调用上限</p>}
                {b.status === "failed" && <p className="mt-2 text-[12px] text-hot">生成失败</p>}
              </>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <p className="mt-2 text-[13px] text-hot">{error}</p>}

      <div className="sticky bottom-0 mt-4 border-t border-line bg-bg pt-3">
        <div className="flex gap-2">
          <textarea
            className="min-h-[44px] flex-1 resize-none rounded-card border border-line bg-field px-3 py-2 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-4 focus:border-accent focus:bg-surface"
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
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="inline-flex h-10 items-center justify-center rounded-full bg-accent px-4 text-[14px] font-medium text-accent-contrast transition-colors hover:bg-accent-ink disabled:opacity-50" disabled={busy || !input.trim()} onClick={() => void send(input)}>发送</button>
          <button type="button" className="inline-flex h-10 items-center justify-center rounded-full border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink-2 transition-colors hover:border-ink-4 hover:text-ink disabled:opacity-50" disabled={!busy} onClick={() => void stop()}>停止</button>
          <button type="button" className="inline-flex h-10 items-center justify-center rounded-full border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink-2 transition-colors hover:border-ink-4 hover:text-ink" onClick={newChat}>新对话</button>
        </div>
      </div>
    </div>
  );
}
