import {
  AFTER_DAYS_PATTERN,
  AFTER_DAYS_PATTERN_DEVANAGARI,
  AFTER_DAYS_PATTERN_ENGLISH,
  DEVANAGARI_DIGITS,
  NEXT_MARKERS,
  NUMBER_WORDS,
  RELATIVE_DAY_WORDS,
  WEEKDAY_WORDS,
} from "./lexicon";
import { containsPhrase } from "./phraseMatch";
import { addDaysAppTz, dateInAppTz, nextWeekday, partsInAppTz, startOfDayInAppTz } from "../time";

export interface DateExtractionResult {
  /** Best-guess absolute date. May be non-null even when ambiguous=true — it is a suggestion, not a fact. */
  date: Date | null;
  ambiguous: boolean;
  confidence: number; // 0..1
  matchedText: string | null;
  reason: string;
}

/**
 * Known festival dates used to resolve phrases like "Diwali ke baad".
 * These must be reviewed/updated every year — see the Language Testing Lab
 * to catch drift instead of silently using a stale date.
 */
const FESTIVAL_DATES: Record<string, Record<number, [number, number, number]>> = {
  diwali: { 2025: [2025, 9, 20], 2026: [2026, 10, 8], 2027: [2027, 9, 29] },
  deepawali: { 2025: [2025, 9, 20], 2026: [2026, 10, 8], 2027: [2027, 9, 29] },
  chhath: { 2025: [2025, 9, 27], 2026: [2026, 10, 15], 2027: [2027, 10, 5] },
  holi: { 2025: [2025, 2, 14], 2026: [2026, 2, 4], 2027: [2027, 2, 23] },
  makar_sankranti: { 2025: [2025, 0, 14], 2026: [2026, 0, 14], 2027: [2027, 0, 15] },
};
const FESTIVAL_ALIASES: Record<string, keyof typeof FESTIVAL_DATES> = {
  diwali: "diwali",
  "दिवाली": "diwali",
  deepawali: "diwali",
  "दीपावली": "diwali",
  chhath: "chhath",
  "छठ": "chhath",
  "chhathi": "chhath",
  holi: "holi",
  "होली": "holi",
  sankranti: "makar_sankranti",
  "संक्रांति": "makar_sankranti",
};

function normalizeDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] ?? d);
}

function tokenize(text: string): string[] {
  return normalizeDigits(text).toLowerCase().split(/\s+/).filter(Boolean);
}

function hasNextMarker(text: string): boolean {
  const lower = text.toLowerCase();
  return NEXT_MARKERS.some((m) => containsPhrase(lower, m));
}

function lastDayOfMonth(year: number, monthIndex0: number): Date {
  let nextMonth = monthIndex0 + 1;
  let nextYear = year;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear += 1;
  }
  const firstOfNextMonth = dateInAppTz(nextYear, nextMonth, 1);
  return startOfDayInAppTz(addDaysAppTz(firstOfNextMonth, -1));
}

export function extractDate(rawText: string, now: Date = new Date()): DateExtractionResult {
  const text = normalizeDigits(rawText || "");
  const lower = text.toLowerCase();
  const tokens = tokenize(text);

  // 1. "aaj" / "kal" / "parso(n)" / "narso(n)"
  for (const [word, offset] of Object.entries(RELATIVE_DAY_WORDS)) {
    if (tokens.includes(word)) {
      return {
        date: startOfDayInAppTz(addDaysAppTz(now, offset)),
        ambiguous: false,
        confidence: 0.9,
        matchedText: word,
        reason: offset === 0 ? "today" : `+${offset} day(s) relative word`,
      };
    }
  }

  // 2. "N din baad" / "N दिन बाद" / "N days later" / "in N days"
  const romanMatch = lower.match(AFTER_DAYS_PATTERN);
  const devMatch = text.match(AFTER_DAYS_PATTERN_DEVANAGARI);
  const englishMatch = lower.match(AFTER_DAYS_PATTERN_ENGLISH);
  const daysMatch = romanMatch || devMatch || englishMatch;
  if (daysMatch) {
    // "N days later" captures into group 1, "in N days" captures into group 3.
    const raw = daysMatch[1] ?? daysMatch[3];
    let n: number | null = null;
    if (raw && /^\d+$/.test(raw)) n = parseInt(raw, 10);
    else if (raw && raw.toLowerCase() in NUMBER_WORDS) n = NUMBER_WORDS[raw.toLowerCase()];
    if (n !== null) {
      return {
        date: startOfDayInAppTz(addDaysAppTz(now, n)),
        ambiguous: false,
        confidence: 0.9,
        matchedText: daysMatch[0],
        reason: `+${n} day(s) ("din baad" / "days later")`,
      };
    }
  }

  // "day after tomorrow" — English equivalent of "parso".
  if (/day after tomorrow/.test(lower)) {
    return {
      date: startOfDayInAppTz(addDaysAppTz(now, 2)),
      ambiguous: false,
      confidence: 0.9,
      matchedText: "day after tomorrow",
      reason: "+2 day(s) relative phrase",
    };
  }

  // 3. Weekday, optionally with a "next" marker ("agle Monday", "agila somar").
  for (const [word, weekday] of Object.entries(WEEKDAY_WORDS)) {
    if (tokens.includes(word)) {
      const forceNext = hasNextMarker(lower);
      return {
        date: nextWeekday(now, weekday, forceNext),
        ambiguous: false,
        confidence: forceNext ? 0.9 : 0.75,
        matchedText: word,
        reason: forceNext ? "next occurrence of named weekday (explicit 'agla')" : "nearest upcoming named weekday",
      };
    }
  }

  // 4. "N tareekh" / "N tarikh" — Nth of the current (or next, if passed) month.
  const tareekhMatch = lower.match(/(\d{1,2})\s*(tareekh|tarikh)/) || text.match(/(\d{1,2})\s*तारीख/);
  if (tareekhMatch) {
    const day = parseInt(tareekhMatch[1], 10);
    if (day >= 1 && day <= 31) {
      const { year, monthIndex0, day: today } = partsInAppTz(now);
      let targetYear = year;
      let targetMonth = monthIndex0;
      if (day <= today) {
        targetMonth += 1;
        if (targetMonth > 11) {
          targetMonth = 0;
          targetYear += 1;
        }
      }
      return {
        date: dateInAppTz(targetYear, targetMonth, Math.min(day, 28)),
        ambiguous: false,
        confidence: 0.85,
        matchedText: tareekhMatch[0],
        reason: "specific day-of-month",
      };
    }
  }

  // 5. "mahina khatam hone se pehle" / "mahine se pehle" / "end of the month" — vague, end of month.
  if (/(mahina|mahine).*(khatam|khatm)|महीना.*(खत्म|खतम)|end\s*of\s*(the\s*)?month/.test(lower)) {
    const { year, monthIndex0 } = partsInAppTz(now);
    return {
      date: lastDayOfMonth(year, monthIndex0),
      ambiguous: true,
      confidence: 0.35,
      matchedText: "mahina khatam hone se pehle",
      reason: "vague month-end reference — ask customer to confirm an exact date",
    };
  }

  // 6. "agla hafta" / "agle hafte" / "next week" — vague, ~7 days, exact day unknown.
  if (/(agla|agle)\s*(hafta|hafte)|अगल[ेा]\s*हफ्त[ेा]|next\s*week/.test(lower)) {
    return {
      date: startOfDayInAppTz(addDaysAppTz(now, 7)),
      ambiguous: true,
      confidence: 0.4,
      matchedText: "agla hafta",
      reason: "vague next-week reference — ask customer for an exact day",
    };
  }

  // 7. Festival-relative: "Diwali ke baad", "Chhath ke baad".
  for (const [alias, key] of Object.entries(FESTIVAL_ALIASES)) {
    if (lower.includes(alias)) {
      const { year } = partsInAppTz(now);
      const table = FESTIVAL_DATES[key];
      let [fy, fm, fd] = table[year] ?? table[year + 1] ?? Object.values(table)[0];
      let festivalDate = dateInAppTz(fy, fm, fd);
      if (festivalDate.getTime() < now.getTime() && table[year + 1]) {
        [fy, fm, fd] = table[year + 1];
        festivalDate = dateInAppTz(fy, fm, fd);
      }
      return {
        date: startOfDayInAppTz(addDaysAppTz(festivalDate, 2)),
        ambiguous: true,
        confidence: 0.4,
        matchedText: alias,
        reason: "festival-relative reference — confirm exact date with customer",
      };
    }
  }

  // 8. "salary aane ke baad" / "after i get my salary" — cannot be resolved to a calendar date at all.
  if (
    /salary.*(aane|milne).*(baad|ke\s*baad)|सैलरी.*बाद|तनख्वाह.*बाद|after\s*(i\s*get\s*)?(my\s*)?salary|when\s*salary\s*comes/.test(
      lower
    )
  ) {
    return {
      date: null,
      ambiguous: true,
      confidence: 0.2,
      matchedText: "salary aane ke baad",
      reason: "salary date unknown — must ask customer for an approximate date",
    };
  }

  return {
    date: null,
    ambiguous: true,
    confidence: 0,
    matchedText: null,
    reason: "no recognizable date phrase",
  };
}
