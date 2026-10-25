export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Open for applications", OFFERED: "Offer sent", ACCEPTED: "Accepted", AWAITING_FUNDING: "Waiting for escrow funding",
  FUNDED: "Funded, not started", IN_PROGRESS: "In progress", PROOF_SUBMITTED: "Proof submitted", REVISION_REQUESTED: "Revision requested",
  APPROVED: "Approved", DISPUTED: "In dispute", PAID: "Paid", REFUNDED: "Refunded", RESOLVED: "Resolved", CANCELLED: "Cancelled",
};
export const STEPS = ["Posted", "Offer accepted", "Escrow funded", "Work delivered", "Paid out"];
export function stepIndex(status: string) {
  if (["DRAFT", "OFFERED"].includes(status)) return 0;
  if (["ACCEPTED", "AWAITING_FUNDING"].includes(status)) return 1;
  if (["FUNDED", "IN_PROGRESS", "REVISION_REQUESTED"].includes(status)) return 2;
  if (["PROOF_SUBMITTED", "DISPUTED", "APPROVED"].includes(status)) return 3;
  return 4;
}
