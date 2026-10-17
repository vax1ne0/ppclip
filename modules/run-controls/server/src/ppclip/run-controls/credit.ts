import { activeRunCredit, readRunControl, utcDay } from "./state.js";
import { ppclipFeature } from "../features.js";

/**
 * ppclip RUN-1 hook for official's daily cap check: runs made while Unlimited was
 * on are stored as a credit for that UTC day and extend only that day's cap, so the
 * credit expires at the next UTC day without any controller running. A draining
 * agent gets no credit: Drain's cap of 0 is a hard stop.
 */
export function ppclipRunCreditForDay(metadata: unknown, dayStart: Date) {
  if (!ppclipFeature("runControls")) return 0;
  if (readRunControl(metadata).draining) return 0;
  return activeRunCredit(metadata, utcDay(dayStart));
}
