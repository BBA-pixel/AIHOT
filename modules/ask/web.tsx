import { defineWebModule } from "@aihot/web/modules";

function IconAsk({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  );
}

export default defineWebModule({
  name: "ask",
  sidebar: {
    section: "更多",
    items: [{ to: "/ask", label: "AI 问答", icon: IconAsk }],
  },
  tools: [
    { to: "/ask", label: "AI 问答", icon: <IconAsk size={20} /> },
  ],
  agent: () => import("./web/agent-part.tsx"),
});
