import { formatHourRange, weekdayLabel, type BestSlot } from "./analytics";

export function bestSlotLabel(s: BestSlot): string {
  return `${weekdayLabel(s.dow)} ${formatHourRange(s.hour)} · ${Math.round(s.rate)}% pick-up (${s.calls} calls)`;
}
