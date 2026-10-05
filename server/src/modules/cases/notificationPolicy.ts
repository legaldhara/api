import type { CaseEventType, RequestCaseType } from "./repository";

export interface CaseNotificationEvent {
  id: string;
  type: CaseEventType | string;
  caseId: string;
  caseType: RequestCaseType;
  targetId: string;
  ownerId: string;
}

export interface CaseNotification {
  recipientId: string;
  channels: ["IN_APP", "EMAIL"];
  title: string;
  body: string;
  templateKey: string;
  clickAction: string;
}

const CONTENT: Partial<Record<CaseEventType, { title: string; body: string; templateKey: string }>> = {
  REVIEW_STARTED: {
    title: "Your request is under review",
    body: "Our team has started reviewing your request.",
    templateKey: "case_review_started",
  },
  ADMIN_MESSAGE: {
    title: "New message on your request",
    body: "Our team sent you a new message.",
    templateKey: "case_admin_message",
  },
  DOCUMENTS_REQUESTED: {
    title: "Documents required",
    body: "Please review and upload the requested documents.",
    templateKey: "case_documents_requested",
  },
  PAYMENT_REQUESTED: {
    title: "Payment required",
    body: "A payment is required to continue processing your request.",
    templateKey: "case_payment_requested",
  },
  CASE_APPROVED: {
    title: "Request approved",
    body: "Your request has been approved.",
    templateKey: "case_approved",
  },
  CASE_REJECTED: {
    title: "Request update",
    body: "Your request could not be approved. Open it to review the details.",
    templateKey: "case_rejected",
  },
  DELIVERABLE_ATTACHED: {
    title: "Document ready",
    body: "A final document has been added to your request.",
    templateKey: "case_deliverable_attached",
  },
  CASE_COMPLETED: {
    title: "Request completed",
    body: "Your request has been completed.",
    templateKey: "case_completed",
  },
  CASE_CLOSED: {
    title: "Request closed",
    body: "Your completed request has been closed.",
    templateKey: "case_closed",
  },
};

export const notificationForCaseEvent = (event: CaseNotificationEvent): CaseNotification | null => {
  const content = CONTENT[event.type as CaseEventType];
  if (!content) return null;
  return {
    recipientId: event.ownerId,
    channels: ["IN_APP", "EMAIL"],
    ...content,
    clickAction: `/dashboard/cases/${event.caseId}`,
  };
};
