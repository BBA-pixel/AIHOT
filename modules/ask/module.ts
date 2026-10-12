import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "ask",
  pages: [{ path: "ask", file: "web/ask.tsx" }],
  apiPaths: [/^\/api\/ask(\/|$)/],
});
