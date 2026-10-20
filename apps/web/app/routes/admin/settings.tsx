import { ADMIN, SITE } from "@aihot/site";
import { useId, useRef, useState } from "react";
import type { Route } from "./+types/settings";
import { MAX_WORKER_CONCURRENCY, type AdminSettings, type WorkerConcurrency } from "@aihot/contracts/admin";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj, num } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, DataTable, Input, ReasonDialog } from "../../features/admin/ui";
import { toast } from "../../features/admin/toast";


export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<AdminSettings>(request, "/api/admin/settings");
}

export const meta: Route.MetaFunction = () => [{ title: `设置 · ${SITE.name} 后台` }];

function QrSlot({ slot, label, src }: { slot: "wechatQr" | "feishuQr"; label: string; src: string | null }) {
  const { run, pending } = useAdminAction();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-4">
      {src ? <img src={src} alt={label} className="size-28 rounded-card bg-white object-contain p-1.5 ring-1 ring-line" /> : <div className="flex size-28 shrink-0 items-center justify-center rounded-card bg-surface text-sm text-ink-4 ring-1 ring-line">未设置</div>}
      <div>
        <div className="text-[14px] font-medium text-ink">{label}</div>
        <div className="mt-0.5 break-all font-mono text-[11.5px] text-ink-4">{src}</div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) return toast("图片最大 2MB", "error");
            const image = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
            await run("POST", "/api/admin/settings/contact-qr", { slot, image }, { label: `qr-${slot}`, success: `${label}已更换，关于页 5 分钟内更新` });
          }}
        />
        <Button className="mt-2" size="sm" busy={pending === `qr-${slot}`} onClick={() => input.current?.click()}>更换图片</Button>
      </div>
    </div>
  );
}

function BudgetRow({ b }: { b: AdminSettings["budgets"][number] }) {
  const { run, pending } = useAdminAction();
  const [v, setV] = useState({ perMinute: b.per_minute, perHour: b.per_hour, perDay: b.per_day });
  const [open, setOpen] = useState(false);
  const changed = v.perMinute !== b.per_minute || v.perHour !== b.per_hour || v.perDay !== b.per_day;
  return (
    <tr className="border-b border-line/70 last:border-0">
      <td className="px-3 py-2 font-mono text-[12.5px]">{b.service}</td>
      {(["perMinute", "perHour", "perDay"] as const).map((k) => (
        <td key={k} className="px-3 py-2">
          <Input type="number" min={0} className="!w-24 !py-1 text-right" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
        </td>
      ))}
      <td className="num px-3 py-2 text-right text-ink-3">{num(b.used_hour)} / {num(b.used_day)}</td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" tone="primary" disabled={!changed} onClick={() => setOpen(true)}>保存</Button>
        <ReasonDialog
          open={open}
          title={`调整 ${b.service} 的请求上限`}
          description={`上限是付费请求的熔断：超过后请求暂停并按窗口重试。填 0 表示立即停用这个服务。${ADMIN.budgetNote ?? ""}`}
          confirmLabel="保存"
          busy={pending === "budget"}
          onClose={() => setOpen(false)}
          onSubmit={async (reason) => (await run("PUT", `/api/admin/budgets/${encodeURIComponent(b.service)}`, { ...v, reason }, { label: "budget", success: "上限已更新" })) !== null}
        />
      </td>
    </tr>
  );
}

function TargetToggle({ t }: { t: AdminSettings["targets"][number] }) {
  const { run, pending } = useAdminAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" tone={t.enabled ? "danger" : "primary"} onClick={() => setOpen(true)}>{t.enabled ? "停用" : "启用"}</Button>
      <ReasonDialog
        open={open}
        title={`${t.enabled ? "停用" : "启用"}：${t.note ?? t.key}`}
        description={t.enabled ? "停用后新的推送不再发往这个群。" : "启用时间会被记录：启用之前的内容不会补推。开发与彩排环境即使启用也不会真的发出。"}
        danger={t.enabled}
        confirmLabel={t.enabled ? "停用" : "启用"}
        busy={pending === "target"}
        onClose={() => setOpen(false)}
        onSubmit={async (reason) => (await run("POST", `/api/admin/notify-targets/${encodeURIComponent(t.key)}`, { enabled: !t.enabled, reason }, { label: "target", success: "已更新" })) !== null}
      />
    </>
  );
}

const CONCURRENCY_FIELDS: Array<{ key: keyof WorkerConcurrency; label: string; hint: string }> = [
  { key: "analyze", label: "内容分析", hint: "预筛、评分与内容理解的文章任务数" },
  { key: "fetch", label: "信源采集", hint: "同时抓取的 RSS、网页或 JSON 信源数" },
  { key: "extract", label: "正文提取", hint: "同时读取和清洗正文的文章数" },
  { key: "digest", label: "事件综述", hint: "同时生成综述的事件数" },
];

function ConcurrencySettings({ settings }: { settings: AdminSettings["concurrency"] }) {
  const id = useId();
  const { run, busy, pending } = useAdminAction();
  const [values, setValues] = useState<Record<keyof WorkerConcurrency, string>>({
    analyze: String(settings.values.analyze), fetch: String(settings.values.fetch),
    extract: String(settings.values.extract), digest: String(settings.values.digest),
  });
  const [touched, setTouched] = useState<Partial<Record<keyof WorkerConcurrency, boolean>>>({});
  const [open, setOpen] = useState(false);
  const valid = (key: keyof WorkerConcurrency) => values[key].trim() !== "" && Number.isInteger(Number(values[key]))
    && Number(values[key]) >= 1 && Number(values[key]) <= MAX_WORKER_CONCURRENCY;
  const allValid = CONCURRENCY_FIELDS.every(({ key }) => valid(key));
  const changed = CONCURRENCY_FIELDS.some(({ key }) => Number(values[key]) !== settings.values[key]);
  return (
    <Card className="mt-5" title="任务并发">
      <p className="text-[13px] leading-relaxed text-ink-3">
        每项为一个工作进程同时处理的任务数。保存后自动应用，正在执行的任务会正常完成。
        任务并发不等于模型请求总并发：内容分析中的评分与结构抽取可能并行，不同任务队列也可能同时调用模型；两次独立评分本身按顺序执行。事件归组保持串行。
      </p>
      <fieldset disabled={busy} className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <legend className="sr-only">后台任务并发设置</legend>
        {CONCURRENCY_FIELDS.map(({ key, label, hint }) => {
          const error = touched[key] && !valid(key);
          return (
            <div key={key} className="min-w-0">
              <label htmlFor={`${id}-${key}`} className="mb-1 block text-[12.5px] font-medium text-ink-2">{label}</label>
              <Input id={`${id}-${key}`} className="min-h-11 sm:min-h-0" type="number" inputMode="numeric" min={1} max={MAX_WORKER_CONCURRENCY} step={1}
                value={values[key]} aria-invalid={error || undefined}
                aria-describedby={`${id}-${key}-hint${error ? ` ${id}-${key}-error` : ""}`}
                onChange={e => setValues({ ...values, [key]: e.target.value })}
                onBlur={() => setTouched({ ...touched, [key]: true })} />
              <p id={`${id}-${key}-hint`} className="mt-1 text-[12px] leading-relaxed text-ink-4">{hint}</p>
              {error && <p id={`${id}-${key}-error`} role="alert" className="mt-1 text-[12px] text-hot">请输入 1–{MAX_WORKER_CONCURRENCY} 的整数</p>}
            </div>
          );
        })}
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-ink-4">
          {settings.configured ? `后台设置更新于 ${bj(settings.updatedAt)}` : "当前使用部署默认值；保存后优先使用后台设置。"}
        </p>
        <Button className="min-h-11 sm:min-h-0" tone="primary" disabled={!changed || !allValid || busy} onClick={() => setOpen(true)}>保存并发设置</Button>
      </div>
      <ReasonDialog open={open} title="调整任务并发" confirmLabel="保存设置"
        description="较低并发会减轻接口和服务器压力，积压任务需要更长时间处理。改动会自动应用，已经开始的任务不会被中断。"
        busy={pending === "concurrency"} onClose={() => setOpen(false)}
        onSubmit={async reason => (await run("PUT", "/api/admin/settings/concurrency", {
          values: Object.fromEntries(CONCURRENCY_FIELDS.map(({ key }) => [key, Number(values[key])])), reason,
        }, { label: "concurrency", success: "并发设置已保存，正在应用" })) !== null} />
    </Card>
  );
}

export default function SettingsAdmin({ loaderData: s }: Route.ComponentProps) {
  return (
    <AdminPage title="设置" subtitle="不改代码即可替换的运营设置。每次修改都写入审计记录。">
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="关于页二维码">
          <div className="space-y-5">
            <QrSlot slot="wechatQr" label="微信公众号二维码" src={s.contact.wechatQr} />
            <QrSlot slot="feishuQr" label="飞书群二维码" src={s.contact.feishuQr} />
          </div>
        </Card>
        <Card title="通知目的地" pad={false}>
          <DataTable
            rows={s.targets}
            rowKey={(t) => t.key}
            columns={[
              { key: "k", label: "目的地", render: (t) => <div><div className="font-medium text-ink">{t.note ?? t.key}</div><div className="font-mono text-[11.5px] text-ink-4">{t.key} · {t.config_ref}</div></div> },
              { key: "e", label: "状态", render: (t) => (t.enabled ? <Badge tone="ok">启用于 {bj(t.enabled_at)}</Badge> : <Badge>停用</Badge>) },
              { key: "d", label: "7 天投递", align: "right", render: (t) => num(t.deliveries_7d) },
              { key: "a", label: "", align: "right", render: (t) => <TargetToggle t={t} /> },
            ]}
          />
        </Card>
      </div>
      <ConcurrencySettings key={s.concurrency.updatedAt ?? JSON.stringify(s.concurrency.values)} settings={s.concurrency} />
      <Card className="mt-5" title="付费请求上限" right={<span>已用：近 1 小时 / 近 24 小时</span>} pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-ink-3">
                <th className="px-3 py-2 font-medium">服务</th>
                <th className="px-3 py-2 font-medium">每分钟</th>
                <th className="px-3 py-2 font-medium">每小时</th>
                <th className="px-3 py-2 font-medium">每天</th>
                <th className="px-3 py-2 text-right font-medium">已用</th>
                <th />
              </tr>
            </thead>
            <tbody>{s.budgets.map((b) => <BudgetRow key={`${b.service}-${b.updated_at}`} b={b} />)}</tbody>
          </table>
        </div>
      </Card>
    </AdminPage>
  );
}
