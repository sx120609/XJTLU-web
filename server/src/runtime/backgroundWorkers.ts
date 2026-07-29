import { startForumImageModerationPoller } from "../services/imageModeration";
import { startMarketReminderPoller } from "../services/marketMatching";
import { startPromotionExpiryPoller } from "../services/promotion";
import { startQqNotificationPoller } from "../services/qqbot";
import { startRuntimeSync } from "../services/runtimeSync";
import { startScheduler } from "../services/schoolCrawler";
import { startSponsorOrderExpiryPoller } from "../services/sponsor";
import { startForumVideoModerationPoller } from "../services/videoModeration";
import { startWeiwallSyncScheduler } from "../services/weiwallSync";
import { startXjtluAnnouncementSyncScheduler } from "../services/xjtluAnnouncementSync";
import { startV1HotRankingPoller } from "../services/v1DiscoveryService";

let backgroundWorkersStarted = false;

/**
 * Start the long-running jobs owned by the main server process.
 *
 * Keeping this outside createApp() makes the Express factory safe to reuse in
 * tests and tooling without silently creating timers, Redis subscriptions, or
 * upstream connections.
 */
export function startBackgroundWorkers() {
  if (backgroundWorkersStarted) return false;
  backgroundWorkersStarted = true;

  startRuntimeSync();
  startForumImageModerationPoller();
  startForumVideoModerationPoller();
  startQqNotificationPoller();
  startSponsorOrderExpiryPoller();
  startPromotionExpiryPoller();
  startMarketReminderPoller();
  startV1HotRankingPoller();
  startScheduler();
  startWeiwallSyncScheduler();
  startXjtluAnnouncementSyncScheduler();

  return true;
}
