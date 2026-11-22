import { formatDateHuman } from "../time";
import { formatInr } from "../nlu/extract";
import type { AiExtraction } from "../nlu/schema";

export interface OwnerReportContext {
  customerName: string;
  outstandingAmount: number;
  callStatusLabel: string;
  customerResponseQuote: string | null;
}

/** Matches the exact "AI CALL REPORT" layout from the product spec. */
export function buildOwnerReportText(ctx: OwnerReportContext, extraction: AiExtraction): string {
  const lines = [
    "AI CALL REPORT",
    "",
    `Customer: ${ctx.customerName}`,
    `Outstanding: ${formatInr(ctx.outstandingAmount)}`,
    `Call Status: ${ctx.callStatusLabel}`,
    "",
    "Customer Response:",
    ctx.customerResponseQuote ? `"${ctx.customerResponseQuote}"` : "-",
    "",
    "Promised Amount:",
    extraction.promisedAmount !== null ? formatInr(extraction.promisedAmount) : "-",
    "",
    "Promised Date:",
    extraction.promisedDate ? formatDateHuman(new Date(extraction.promisedDate)) : "-",
    "",
  ];
  if (extraction.remainderAmount !== null) {
    lines.push(
      "Remaining Balance (after this promise):",
      `${formatInr(extraction.remainderAmount)}${
        extraction.remainderDate ? ` — by ${formatDateHuman(new Date(extraction.remainderDate))}` : ""
      }`,
      ""
    );
  }
  lines.push(
    "AI Summary:",
    extraction.summary,
    "",
    "Next Follow-up:",
    extraction.nextFollowUpDate ? formatDateHuman(new Date(extraction.nextFollowUpDate)) : "-",
    "",
    "Confidence:",
    `${Math.round(extraction.confidence * 100)}%`
  );
  if (extraction.verificationRequired) {
    lines.push("", "⚠ PAYMENT VERIFICATION REQUIRED — staff must confirm before any payment is recorded.");
  }
  return lines.join("\n");
}
