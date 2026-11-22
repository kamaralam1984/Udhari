import { z } from "zod";

/**
 * Strict schema for the structured JSON every completed AI conversation must
 * produce. Nothing derived from this is allowed to touch a financial record
 * (PromiseToPay, Customer.outstandingAmount, etc.) unless it passes this
 * validation first.
 */
export const AiExtractionSchema = z.object({
  callStatus: z.enum([
    "QUEUED",
    "RINGING",
    "CONNECTED",
    "NO_ANSWER",
    "BUSY",
    "FAILED",
    "COMPLETED",
    "AI_UNCERTAIN",
    "CALLBACK_REQUESTED",
    "WRONG_NUMBER",
  ]),
  customerResponse: z.string(),
  paymentIntent: z.enum([
    "WILL_PAY",
    "PARTIAL_PAY",
    "CANNOT_PAY",
    "ALREADY_PAID",
    "REFUSED",
    "CALLBACK_REQUESTED",
    "WRONG_NUMBER",
    "UNCLEAR",
  ]),
  promisedAmount: z.number().nonnegative().nullable(),
  promisedDate: z.string().nullable(), // ISO date string, validated separately
  // Set only for a confirmed PARTIAL_PAY promise where the customer's own
  // words indicated more money is coming later — see engine.ts's
  // progressAfterExtraction / dialogue.ts's askRemainder.
  remainderAmount: z.number().nonnegative().nullable(),
  remainderDate: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  nextFollowUpDate: z.string().nullable(),
  verificationRequired: z.boolean(),
  callbackRequested: z.boolean(),
});

export type AiExtraction = z.infer<typeof AiExtractionSchema>;

export function validateAiExtraction(candidate: unknown):
  | { success: true; data: AiExtraction }
  | { success: false; errors: string[] } {
  const parsed = AiExtractionSchema.safeParse(candidate);
  if (parsed.success) return { success: true, data: parsed.data };
  return { success: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}
