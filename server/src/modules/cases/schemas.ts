import { z } from "zod";

const maximumPaymentAmountMinor = Number(process.env.MAX_PAYMENT_AMOUNT_MINOR) || 100_000_000;

export const commandBase = z.object({
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(8).max(100),
}).strict();

export const emptyCommandSchema = commandBase;

export const messageSchema = commandBase.extend({
  message: z.string().trim().min(1).max(2_000),
}).strict();

export const documentRequestSchema = commandBase.extend({
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(2_000),
  documentLabels: z.array(z.string().trim().min(1).max(80)).min(1).max(20)
    .refine((labels) => new Set(labels).size === labels.length, "Document labels must be unique"),
}).strict();

export const documentSubmissionSchema = commandBase.extend({
  assets: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    assetId: z.string().uuid(),
  }).strict()).min(1).max(20),
}).strict();

export const paymentRequestSchema = commandBase.extend({
  category: z.enum(["INITIAL", "OBJECTION", "ADDITIONAL", "CORRECTION"]),
  amountMinor: z.number().int().positive().max(maximumPaymentAmountMinor),
  purpose: z.string().trim().min(1).max(160),
}).strict();

export const cancelRequirementSchema = commandBase.extend({
  reason: z.string().trim().min(5).max(500),
}).strict();

export const rejectSchema = commandBase.extend({
  reason: z.string().trim().min(5).max(1_000),
}).strict();

export const deliverableSchema = commandBase.extend({
  assetId: z.string().uuid(),
  label: z.string().trim().min(1).max(120).optional(),
}).strict();

export const completeSchema = commandBase.extend({
  completionSummary: z.string().trim().min(20).max(2_000).optional(),
  completionReference: z.string().trim().min(1).max(200).optional(),
}).strict().refine(
  (input) => (input.completionSummary === undefined) === (input.completionReference === undefined),
  "Completion summary and reference must be provided together",
);
