# GAMEHOT 前端设计 Token / 视觉规范

> 主视觉：**墨铜暗刊**（dark）· 日间：**瓷光浅馆**（light）  
> 栈：React Router SSR + Tailwind 4 · 主题用 CSS 变量切换  
> 硬约束：保留左侧边栏（资讯 / 热点 / AI 日报 / 主题 / 收藏 + 更多里的 Agent 接入等），栏目结构不砍

---

## 1. 色板（CSS 变量语义）

### Dark — 墨铜暗刊

| Token | Hex | 用途 |
|-------|-----|------|
| `--bg` | `#0A0A0B` | 页面底 |
| `--bg-elevated` | `#121214` | 侧栏、浮层、略抬升面 |
| `--surface` | `#161618` | 卡片、榜单条、输入底 |
| `--surface-hover` | `#1C1C1F` | hover / 选中浅提亮 |
| `--text` | `#F3EFE7` | 主文、大标题 |
| `--text-secondary` | `#C8C2B6` | 摘要、副标题 |
| `--muted` | `#8A857C` | 元信息、日期、次要导航 |
| `--accent` | `#C4A484` | 选中下划线、箭头、榜单序号、Selected 标签 |
| `--accent-muted` | `#C4A48433` | accent 浅底（约 20% 透明） |
| `--hot` | `#C4A484` | dark 下「热点」与 accent 同色，不另起朱红 |
| `--border` | `#2A2A2E` | 细分割线、卡片描边 |
| `--border-strong` | `#3A3A40` | 侧栏分隔、强调线 |
| `--focus-ring` | `#C4A48466` | 键盘焦点环 |
| `--overlay` | `#000000A6` | 模态遮罩 |

### Light — 瓷光浅馆

| Token | Hex | 用途 |
|-------|-----|------|
| `--bg` | `#F6F1EA` | 暖纸底（可加极轻纸纹，opacity ≤ 4%） |
| `--bg-elevated` | `#FFFBF6` | 侧栏、浮层 |
| `--surface` | `#FFFFFF` | 卡片面（或同 `--bg` + 细边，二选一保持克制） |
| `--surface-hover` | `#EFE8DE` | hover |
| `--text` | `#1A1A1A` | 主文、大标题 |
| `--text-secondary` | `#3D3A36` | 摘要 |
| `--muted` | `#8A847A` | 元信息、日期 |
| `--accent` | `#8B6914` | 导航下划线、链接箭头（偏墨金，避免抢朱红） |
| `--accent-muted` | `#8B69141A` | accent 浅底 |
| `--hot` | `#B42318` | **仅**热点印章 / HOT 角标 |
| `--border` | `#E4DDD2` | 细分割线 |
| `--border-strong` | `#D0C8BA` | 侧栏分隔 |
| `--focus-ring` | `#B4231840` | 焦点环（弱朱红） |
| `--overlay` | `#1A1A1A73` | 模态遮罩 |

### 语义映射（组件层只用语义名）

```
bg / bg-elevated / surface / surface-hover
text / text-secondary / muted
accent / accent-muted / hot
border / border-strong / focus-ring / overlay
```

Tailwind 4：在 `@theme` 里挂 `var(--*)`，组件写 `bg-surface text-text border-border` 这类语义类，禁止散落硬编码 hex。

---

## 2. 字体

### Display（衬线大标题）

| 场景 | 方案 | 备注 |
|------|------|------|
| 中文 Display | **Noto Serif SC**（Google Fonts）或系统 `Songti SC` / `STSong` fallback | 首页主标、精选标题、杂志感头条 |
| 英文 Display | **Playfair Display** 或 **Source Serif 4** | Logo「GAMEHOT」、英文专名 |

### Body / UI（无衬线）

| 场景 | 方案 | 备注 |
|------|------|------|
| 中文 Body / UI | **Noto Sans SC** 或系统 `PingFang SC` / `Microsoft YaHei` | 导航、摘要、榜单、按钮 |
| 英文 Body | **Inter** 或系统 `ui-sans-serif` | 与中文混排时 Inter + Noto Sans SC |

### 字号阶梯（桌面）

| Token | Size / Line / Weight | 用途 |
|-------|----------------------|------|
| `display-xl` | 40–48px / 1.15 / 600–700 | 首页精选主标 |
| `display-lg` | 28–32px / 1.2 / 600 | 栏目页头条 |
| `title-md` | 18–20px / 1.35 / 600 | 卡片标题 |
| `body` | 14–15px / 1.6 / 400 | 摘要、正文导语 |
| `ui` | 13–14px / 1.4 / 400–500 | 导航、元信息 |
| `caption` | 11–12px / 1.4 / 400 | 日期、标签 |
| `rank` | 14–16px / 1 / 600 tabular | 榜单 01–05 |

字距：Display 中文略松（`tracking-wide` 约 0.02–0.04em）；UI 字正常。Logo 全大写时可 `tracking-[0.12em]`。

加载：`font-display` / `font-sans` 两个 CSS 变量；SSR 预连 Google Fonts 或自托管 woff2，避免 FOUT 过大。

---

## 3. 间距与圆角

### 间距尺度（4 基准）

| Token | px | 用途 |
|-------|-----|------|
| `space-1` | 4 | 图标与字间隙 |
| `space-2` | 8 | 紧凑内边 |
| `space-3` | 12 | 标签内边、列表项竖向半档 |
| `space-4` | 16 | 卡片内边默认、导航项 |
| `space-5` | 24 | 区块内组距 |
| `space-6` | 32 | 卡片网格 gap |
| `space-7` | 48 | 主内容区段距 |
| `space-8` | 64 | 杂志大留白（hero 上下） |

页面水平：主栏 `px-6`–`px-8`（≥1280 可 `px-10`）；侧栏内 `px-4`。

### 圆角

| Token | px | 用途 |
|-------|-----|------|
| `radius-mark` | 5 | 行内 code、kbd、小标签色块 |
| `radius-control` | 8 | 小块、骨架、部分控件 |
| `radius-tile` | 10 | 列表行、媒体块、侧栏项 |
| `radius-card` | 12 | 卡片、气泡、表单面 |
| `radius-panel` | 14 | wells、大图面板 |
| `radius-sheet` | 16 | 抽屉、对话框、hero 壳 |
| `radius-full` | 9999 | 按钮、搜索框、徽章、主题切换、头像、圆形图标钮 |

原则：与上游 AIHOT 半径阶梯对齐；控件/搜索/徽章用 `rounded-full` pill，卡片用 `rounded-card`。保留墨铜／瓷光色与左侧边栏结构。

### 线宽

- 分割线 / 卡片边：`1px` `border`
- 导航选中下划线：`1px` accent，与字底距 4–6px
- 侧栏与主区：`1px` `border-strong` 竖线

### 阴影

- Dark：默认无阴影；浮层最多 `0 8px 24px rgba(0,0,0,0.45)`
- Light：极轻纸影 `0 1px 0 border` 或 `0 4px 16px rgba(26,26,26,0.06)`；可用长向弱投影暗示窗光，禁止 Material 厚影

---

## 4. 布局原则（侧栏 + 资讯首页杂志感）

### 骨架

```
┌────────┬──────────────────────────────────┐
│ Sidebar│  Top meta / 精选|全部 / 工具条     │
│ 固定宽 │──────────────────────────────────│
│ ~220–  │  Hero 精选（非对称）  │  热门榜单  │
│ 240px  │  大标题+图            │  01–05    │
│        │──────────────────────────────────│
│ 资讯   │  资讯卡片网格 / 列表流             │
│ 热点   │                                  │
│ AI日报 │                                  │
│ 主题   │                                  │
│ 收藏   │                                  │
│ 更多…  │                                  │
└────────┴──────────────────────────────────┘
```

- 侧栏：`position: sticky` 全高，`bg-elevated`，右缘 `border-strong`；**不折叠栏目**，图标+文字横排，选中用左侧 2px accent 条或文字+下划线，不要霓虹条。
- 主区：最大宽约 `1100–1280px` 居中于侧栏右侧剩余空间，保持杂志栏宽，忌拉满无边。
- **非对称 Hero**：左（或左+中）大衬线标题 + 短摘要 +「阅读全文 →」；右或右上大气质图；再右侧或右下「热门榜单」竖栏，用竖线与主文区隔。
- 留白：Hero 上下 `space-7`–`space-8`；网格 `gap-6`–`gap-8`；刻意留空，勿堆满。
- 侧栏是「馆的回廊」，主区是「展开的内页」——侧栏克制、主区戏剧性，反差即杂志感。

### 响应式

- `<1024`：侧栏收为图标轨或抽屉（栏目仍在，不删项）；Hero 改单列，榜单改横滑或折到 Hero 下。
- 移动端 Display 字号下调一档，避免断行难看。

---

## 5. 组件样式要点

### 资讯卡片

- 卡片圆角（`radius-card` = 12）、`surface` 或透明底 + 底部分割线流（二选一，全站统一）。
- 图：16:10 或 3:2，desaturate 轻微；Light 可细白边；Dark 无描边或 `border` 1px。
- 上：分类徽标（`caption` + `muted`）；中：`title-md` 衬线或半粗无衬线（建议卡片用无衬线半粗，Display 留给 Hero）；下：日期 `caption muted`。
- Hot 角标：仅 Light 用 `--hot` 小方印；Dark 用 `--accent` 小字「精选/HOT」，忌大红渐变徽章。
- Hover：`surface-hover` 或图轻微亮度 +2%，无缩放弹跳。

### 热点榜（热门榜单）

- 序号 `01`–`05`：`accent` + tabular nums + 半粗。
- 标题一行截断；下一行 `muted` 短说明可选。
- 项间 `1px border`；底「查看完整榜单 →」`accent` 文字链。
- 不要进度条、火焰图标、跳动动画。

### 精选 | 全部 切换

- 文字段控：两词横排，中间细竖线或间距 `space-4`。
- 选中：`text` + 下方 `1px accent` 下划线；未选：`muted`。
- 不要 pill、不要填充底块、不要滑动指示块。

### 侧栏项

- 高约 40px；图标 18–20px，`muted`，选中时 `text` 或 `accent`。
- 「更多」展开：Agent 接入等次级项缩进 `space-4`，字号 `caption`/`ui`。
- 底可放极小版 Logo 或主题切换（日月），不抢主导航。

### 链接 / CTA

- 「阅读全文」「查看更多」：无衬线 + `accent` 箭头 `→`，无按钮填充（主 CTA 例外时用 `accent` pill 钮，字 `text`）。

---

## 6. 禁止项（Anti-AI-slop）

1. **霓虹、紫粉渐变、RGB 灯效、玻璃拟态强模糊**
2. **霓虹玻璃拟态、浮动大阴影**；半径跟上游阶梯，勿自造 0–4px 直角杂志切边
3. **Inter 唯一全站 + 无衬线大标题**（丢失杂志感）
4. **Emoji 当图标、火焰/闪电热度动画**
5. **多色标签彩虹**：Light 朱红只给热点印；Dark 点缀只留哑光铜
6. **侧栏砍栏目或改成顶栏主导航**（结构硬约束）
7. **组件内散落 hex**：必须走 CSS 变量语义 token
8. **过度动效**：入场弹跳、视差过重；过渡 ≤ 150–200ms ease
9. **假 3D、赛博网格、粒子背景**
10. **正文区居中短行 + 巨大空白浪费** 与 **信息墙堆砌** 两极；保持编辑部式节奏感

---

## 落地检查清单（给开发）

- [ ] `:root` / `[data-theme=light]` 写齐上表变量  
- [ ] Tailwind `@theme` 映射语义色与 `font-display` / `font-sans`  
- [ ] 侧栏四栏 + 收藏 + 更多结构保留  
- [ ] 资讯首页：非对称 Hero + 榜单 + 精选|全部 + 卡片流  
- [ ] Dark 默认；系统/手动切 Light  
- [ ] 对照本节「禁止项」做一次视觉 QA  

