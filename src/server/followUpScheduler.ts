import { runFollowUpSweep } from "../lib/followUp/scheduler";
import { dispatchPendingNotifications } from "../lib/notifications/dispatcher";
import { runAlertSweep } from "../lib/alerts";
import { runDailyReport } from "../lib/dailyReport";

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 min — due-date granularity is daily, not minute-precise

/**
 * The only background job in the app, run inside the custom server process
 * (see server.ts) since it's already persistent (not serverless). A plain
 * interval is enough — no node-cron dependency needed. This is a pure timer
 * with zero HTTP/WS surface; it must never touch server.ts's WS upgrade
 * routing or src/server/twilioStreamHandler.ts's live-call audio loop.
 */
export function startScheduledJobs() {
  const tick = async () => {
    // Alerts + daily report write owner notifications, so they run BEFORE the
    // dispatch step below and go out in the same tick. Each is isolated so one
    // failure never blocks follow-ups.
    try {
      const alerts = await runAlertSweep();
      const reported = await runDailyReport();
      if (alerts.sent || reported) console.log(`[scheduler] alerts sent=${alerts.sent} daily-report=${reported ? "sent" : "no"}`);
    } catch (err) {
      console.error("[scheduler] alerts/report failed:", err);
    }

    try {
      const dispatch = await dispatchPendingNotifications();
      const sweep = await runFollowUpSweep();
      console.log(
        `[scheduler] notifications: sent=${dispatch.sent} failed=${dispatch.failed} skipped(no owner number)=${dispatch.skippedNoOwnerNumber} | ` +
          `follow-ups: broken=${sweep.brokenPromises} reminders sent=${sweep.remindersSent} skipped=${sweep.remindersSkipped} ` +
          `AI calls placed=${sweep.aiCallsPlaced} skipped=${sweep.aiCallsSkipped} deferred(best time)=${sweep.aiCallsDeferred}`
      );
    } catch (err) {
      console.error("[scheduler] tick failed:", err);
    }
  };

  tick(); // run once at startup instead of waiting for the first interval
  setInterval(tick, SWEEP_INTERVAL_MS);
  console.log(`> Follow-up scheduler started (every ${SWEEP_INTERVAL_MS / 60000} min)`);
}
