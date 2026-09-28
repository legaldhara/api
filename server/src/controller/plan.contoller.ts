import { Request, Response } from "express";
import { prisma } from "../config/db";
import { AuthRequest } from "../types/custom";
import { createCharge } from "../modules/payments/chargeService";
import { planChargeInput } from "../modules/payments/domainChargeCreation";

export const getPlans = async (_request: Request, response: Response): Promise<void> => {
  const plans = await prisma.plan.findMany({
    where: { deletedAt: null },
    orderBy: { price: "asc" },
  });
  response.status(200).json({ success: true, data: plans });
};

export const createPlanCharge = async (request: Request, response: Response): Promise<void> => {
  const auth = (request as AuthRequest).auth;
  const plan = await prisma.plan.findFirst({
    where: { id: request.params.planId, deletedAt: null },
  });
  if (!plan) {
    response.status(404).json({ success: false, message: "Plan not found" });
    return;
  }
  const charge = await createCharge(planChargeInput({
    userId: auth.id,
    planId: plan.id,
    planName: plan.name,
    price: plan.price,
  }));
  response.status(201).json({
    success: true,
    data: {
      chargeId: charge.id,
      amountMinor: charge.amountMinor,
      currency: charge.currency,
      purpose: charge.purpose,
    },
  });
};
