import { formatInr } from "../nlu/extract";
import { formatDateHuman } from "../time";

interface BillOrderItem {
  itemName: string;
  quantity: number | string;
  unit: string | null;
  rate: number | string;
  amount: number | string;
}

interface BillOrder {
  orderNumber: string;
  totalAmount: number | string;
  paidAmount: number | string;
  promisedPaymentDate: Date | string | null;
  items: BillOrderItem[];
}

/** WhatsApp bill text sent to the customer — req 2's "Bill customer ko WhatsApp par bheja ja sake". */
export function buildBillMessage(businessName: string, order: BillOrder): string {
  const lines = order.items.map(
    (it) => `${it.itemName} — ${it.quantity}${it.unit ? ` ${it.unit}` : ""} x ${formatInr(Number(it.rate))} = ${formatInr(Number(it.amount))}`
  );
  const credit = Number(order.totalAmount) - Number(order.paidAmount);
  const parts = [
    `${businessName} — Bill ${order.orderNumber}`,
    "",
    ...lines,
    "",
    `Total: ${formatInr(Number(order.totalAmount))}`,
    `Paid: ${formatInr(Number(order.paidAmount))}`,
    credit > 0 ? `Balance (udhar): ${formatInr(credit)}` : "Fully paid — dhanyavaad!",
  ];
  if (credit > 0 && order.promisedPaymentDate) {
    parts.push(`Payment due: ${formatDateHuman(order.promisedPaymentDate)}`);
  }
  return parts.join("\n");
}

interface PaymentReceipt {
  receiptNumber: string;
  amount: number | string;
  collectedAt: Date | string;
}

/** WhatsApp payment receipt sent to the customer after cash is recorded — req 7. */
export function buildPaymentReceiptMessage(businessName: string, receipt: PaymentReceipt, remainingOutstanding: number): string {
  const parts = [
    `${businessName} — Payment Receipt ${receipt.receiptNumber}`,
    "",
    `Amount received: ${formatInr(Number(receipt.amount))}`,
    `Date: ${formatDateHuman(receipt.collectedAt)}`,
    remainingOutstanding > 0 ? `Remaining balance: ${formatInr(remainingOutstanding)}` : "Outstanding fully cleared — dhanyavaad!",
  ];
  return parts.join("\n");
}

/** Pre-due / due-today nudge — automatic follow-up (req 4), sent before the promised/due date passes. */
export function buildDueReminderMessage(businessName: string, customerName: string, amount: number, dueDate: Date | string): string {
  return [
    `${businessName}`,
    "",
    `Namaste ${customerName} ji,`,
    `Aapka payment ${formatInr(amount)} ${formatDateHuman(dueDate)} ko due hai. Kripya samay par bhugtan karein.`,
  ].join("\n");
}

/** Sent once the promised/due date has passed without payment — req 4/6. */
export function buildOverdueReminderMessage(businessName: string, customerName: string, amount: number, dueDate: Date | string): string {
  return [
    `${businessName}`,
    "",
    `Namaste ${customerName} ji,`,
    `Aapka payment ${formatInr(amount)} ki due date (${formatDateHuman(dueDate)}) nikal chuki hai. Kripya jald se jald bhugtan karein.`,
  ].join("\n");
}
