export type PaymentActorRole = "ADMIN" | "COADMIN" | "USER";

export interface PaymentActor {
  id: string;
  role: PaymentActorRole;
}

export type PaymentTarget =
  | { type: "APPLICATION"; applicationId: string }
  | { type: "CERTIFICATE"; certificateRequestId: string }
  | { type: "PLAN"; planId: string };

export type PaymentCategory = "INITIAL" | "OBJECTION" | "ADDITIONAL" | "CORRECTION" | "PLAN";
export type PaymentChargeStatus = "OPEN" | "PAID" | "REFUNDED" | "CANCELLED";

export interface PaymentChargeRecord {
  id: string;
  userId: string;
  targetType: PaymentTarget["type"];
  applicationId: string | null;
  certificateRequestId: string | null;
  planId: string | null;
  sourceApplicationUpdateId: string | null;
  sourceCertificateUpdateId: string | null;
  category: PaymentCategory;
  amountMinor: number;
  currency: string;
  purpose: string;
  status: PaymentChargeStatus;
  paidAttemptId: string | null;
  paidAt: Date | null;
  refundedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateChargeInput {
  userId: string;
  target: PaymentTarget;
  category: PaymentCategory;
  amountMinor: number;
  currency: "INR";
  purpose: string;
  sourceUpdateId?: string;
}

export interface PersistedChargeInput {
  userId: string;
  targetType: PaymentTarget["type"];
  applicationId: string | null;
  certificateRequestId: string | null;
  planId: string | null;
  sourceApplicationUpdateId: string | null;
  sourceCertificateUpdateId: string | null;
  category: PaymentCategory;
  amountMinor: number;
  currency: "INR";
  purpose: string;
}

export type PaymentAttemptStatus =
  | "CREATING"
  | "PENDING"
  | "AUTHORIZED"
  | "SUCCESS"
  | "FAILED"
  | "EXPIRED"
  | "DUPLICATE_SUCCESS";

export interface PaymentAttemptRecord {
  id: string;
  chargeId: string;
  gateway: "RAZORPAY";
  status: PaymentAttemptStatus;
  amountMinor: number;
  currency: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  expiresAt: Date;
}
