import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export const APP_TIMEZONE = process.env.TIMEZONE || "Asia/Kolkata";

/** Current instant, as an absolute Date (UTC internally, always). */
export function nowUtc(): Date {
  return new Date();
}

/**
 * Build an absolute Date from a calendar date/time that a customer means in
 * the business timezone (e.g. "15 tareekh" = the 15th, IST).
 */
export function dateInAppTz(
  year: number,
  monthIndex0: number,
  day: number,
  hour = 12,
  minute = 0,
  second = 0
): Date {
  const naive = new Date(year, monthIndex0, day, hour, minute, second);
  const naiveIso = `${year.toString().padStart(4, "0")}-${(monthIndex0 + 1)
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}T${hour
    .toString()
    .padStart(2, "0")}:${minute.toString().padStart(2, "0")}:${second
    .toString()
    .padStart(2, "0")}`;
  void naive;
  return fromZonedTime(naiveIso, APP_TIMEZONE);
}

/** Break an absolute Date into its Y/M/D/H/M as seen in the business timezone. */
export function partsInAppTz(d: Date) {
  const zoned = toZonedTime(d, APP_TIMEZONE);
  return {
    year: zoned.getFullYear(),
    monthIndex0: zoned.getMonth(),
    day: zoned.getDate(),
    hour: zoned.getHours(),
    minute: zoned.getMinutes(),
    weekday: zoned.getDay(), // 0 = Sunday
  };
}

export function startOfDayInAppTz(d: Date): Date {
  const { year, monthIndex0, day } = partsInAppTz(d);
  return dateInAppTz(year, monthIndex0, day, 0, 0, 0);
}

export function addDaysAppTz(d: Date, days: number): Date {
  const { year, monthIndex0, day, hour, minute } = partsInAppTz(d);
  const base = dateInAppTz(year, monthIndex0, day, hour, minute);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export function formatDateHuman(d: Date | string | null | undefined): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return formatInTimeZone(date, APP_TIMEZONE, "dd MMM yyyy");
}

export function formatDateTimeHuman(d: Date | string | null | undefined): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return formatInTimeZone(date, APP_TIMEZONE, "dd MMM yyyy, hh:mm a");
}

export function isWithinQuietHours(d: Date, quietStartHour: number, quietEndHour: number): boolean {
  const { hour } = partsInAppTz(d);
  if (quietStartHour === quietEndHour) return false;
  if (quietStartHour < quietEndHour) {
    return hour >= quietStartHour && hour < quietEndHour;
  }
  // wraps past midnight, e.g. 21 -> 9
  return hour >= quietStartHour || hour < quietEndHour;
}

/** Named weekdays used by the date-extraction NLU ("agle Monday", "agla somvar"). */
export const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  ravivar: 0,
  monday: 1,
  somvar: 1,
  somar: 1,
  tuesday: 2,
  mangalvar: 2,
  wednesday: 3,
  budhvar: 3,
  thursday: 4,
  guruvar: 4,
  brihaspativar: 4,
  friday: 5,
  shukravar: 5,
  saturday: 6,
  shanivar: 6,
};

/** Next occurrence (strictly after `from`) of the given weekday (0=Sun..6=Sat). */
export function nextWeekday(from: Date, targetWeekday: number, forceNextWeek = false): Date {
  const { weekday } = partsInAppTz(from);
  let diff = (targetWeekday - weekday + 7) % 7;
  if (diff === 0) diff = forceNextWeek ? 7 : 0;
  return startOfDayInAppTz(addDaysAppTz(from, diff));
}
