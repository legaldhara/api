import { ApplicationStatus, PaymentType } from "@prisma/client";
import { prisma } from "./db";

// Allowed status transitions with skip options
export const ApplicationWorkflow: Record<ApplicationStatus, ApplicationStatus[]> = {
  AWAITING_ACTION: [ApplicationStatus.PAYMENT_REQUIRED],
  PAYMENT_REQUIRED: [ApplicationStatus.PAYMENT_DONE],
  PAYMENT_DONE: [ApplicationStatus.UNDER_REVIEW],
  UNDER_REVIEW: [
    ApplicationStatus.DATA_REQUIRED,
    ApplicationStatus.PAYMENT_REQUIRED,
    ApplicationStatus.APPROVED,
    ApplicationStatus.REJECTED,
  ],
  DATA_REQUIRED: [ApplicationStatus.UNDER_REVIEW],
  APPROVED: [ApplicationStatus.COMPLETED],
  REJECTED: [ApplicationStatus.PAYMENT_REQUIRED, ApplicationStatus.CLOSED],
  COMPLETED: [ApplicationStatus.CLOSED],
  CLOSED: []
};


export async function updateApplicationStatus(
    applicationId: string,
    nextStatus: ApplicationStatus,
    updaterId: string,
    paymentId?: string,
    paymentType?: PaymentType,
    force: boolean = false
) {
    // Fetch the application
    const app = await prisma.application.findUnique({ where: { id: applicationId } });
    if (!app) throw new Error("Application not found");

    // Get allowed next statuses from workflow
    const allowedNext = ApplicationWorkflow[app.applicationStatus];

    // Validate transition
    if (!allowedNext.includes(nextStatus) && !force) {
        throw new Error(`Cannot transition from ${app.applicationStatus} to ${nextStatus}`);
    }

    // Update application status and create an update record
    const updatedApp = await prisma.application.update({
        where: { id: applicationId },
        data: {
            applicationStatus: nextStatus,
            updates: {
                create: {
                    updaterBy: updaterId,
                    prevStatus: app.applicationStatus,
                    newStatus: nextStatus,
                    paymentId: paymentId,
                    type: paymentType,
                    meta: force ? { forced: true } : {}
                }
            }
        }
    });

    return updatedApp;
}