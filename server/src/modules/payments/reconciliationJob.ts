import cron, { ScheduledTask } from "node-cron";
import { reconcileStaleAttempts } from "./reconciliationService";

let task: ScheduledTask | undefined;

export const startPaymentReconciliationJob = (): void => {
  if (process.env.NODE_ENV === "test" || task) return;
  task = cron.schedule("*/5 * * * *", () => {
    void reconcileStaleAttempts({ limit: 50 });
  });
};

export const stopPaymentReconciliationJob = (): void => {
  task?.stop();
  task = undefined;
};
