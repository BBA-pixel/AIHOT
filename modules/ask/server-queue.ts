import { defineQueue } from "@aihot/backend/modules";
import { runAskTask } from "./src/agent/loop.ts";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

export interface AskRunJob {
  taskId: string;
}

const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

export const askRunQueue = defineQueue<AskRunJob>({
  name: "ask.run",
  options: {
    policy: "short",
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 600,
  },
  worker: { batchSize: 1, pollingIntervalSeconds: 1 },
  run: async (jobs) => {
    for (const job of jobs) {
      await runAskTask({ taskId: job.taskId, workerId });
    }
    return { ok: true, n: jobs.length };
  },
});
