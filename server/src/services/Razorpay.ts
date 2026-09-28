import Razorpay from "razorpay";
import crypto from "crypto";
import { logger } from "../utils/logger";

class RazorpayService {
  private client?: Razorpay;

  constructor() {
    const keyId = process.env.RAZORPAY_KEY_ID!;
    const keySecret = process.env.RAZORPAY_KEY_SECRET!;

    if (keyId && keySecret) {
      this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    }
  }

  private getClient(): Razorpay {
    if (!this.client) throw new Error("Razorpay credentials are missing.");
    return this.client;
  }

  /**
   * ✅ Create new payment order
   */
  async createOrder(amount: number, currency = "INR", receipt?: string, notes?: Record<string, any>) {
    try {
      const order = await this.getClient().orders.create({
        amount, // Convert to paise
        currency,
        receipt: receipt || `receipt_${Date.now()}`,
        notes,
      });

      logger.info("Razorpay Order Created", { orderId: order.id });
      return order;
    } catch (error: any) {
      logger.error("Razorpay createOrder failed", {
        message: error.message,
        stack: error.stack,
      });
      throw new Error("Failed to create Razorpay order");
    }
  }

  /**
   * ✅ Verify payment signature (from frontend)
   */
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
    try {
      const body = orderId + "|" + paymentId;
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
        .update(body)
        .digest("hex");

      const provided = Buffer.from(signature, "hex");
      const expected = Buffer.from(expectedSignature, "hex");
      const isValid = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

      logger.info("Razorpay Signature Verification", { isValid });
      return isValid;
    } catch (error: any) {
      logger.error("Error verifying Razorpay signature", error);
      throw new Error("Payment verification failed");
    }
  }

  /**
   * ✅ Check order/payment status from Razorpay API
   */
  async fetchOrder(orderId: string) {
    try {
      return await this.getClient().orders.fetch(orderId);
    } catch (error: any) {
      logger.error("Razorpay fetchOrder failed", {
        message: error.message,
        stack: error.stack,
      });
      throw new Error("Failed to fetch Razorpay order");
    }
  }

  async fetchPayment(paymentId: string) {
    try {
      return await this.getClient().payments.fetch(paymentId);
    } catch (error: any) {
      logger.error("Razorpay fetchPayment failed", {
        message: error.message,
        stack: error.stack,
      });
      throw new Error("Failed to fetch Razorpay payment");
    }
  }

  async fetchPaymentsForOrder(orderId: string) {
    try {
      return await this.getClient().orders.fetchPayments(orderId);
    } catch (error: any) {
      logger.error("Razorpay fetchPaymentsForOrder failed", { message: error.message, stack: error.stack });
      throw new Error("Failed to fetch Razorpay order payments");
    }
  }

  /**
   * ✅ Initiate refund
   */
  async initiateRefund(paymentId: string, amount?: number, notes?: Record<string, any>) {
    try {
      const refund = await this.getClient().payments.refund(paymentId, {
        amount: amount ? amount * 100 : undefined,
        notes,
      });

      logger.info("Razorpay Refund Initiated", { refundId: refund.id });
      return refund;
    } catch (error: any) {
      logger.error("Razorpay initiateRefund failed", {
        message: error.message,
        stack: error.stack,
      });
      throw new Error("Failed to initiate Razorpay refund");
    }
  }

  /**
   * ✅ Validate Webhook
   */
  validateWebhook(signature: string, body: string | Buffer) {
    try {
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
        .update(body)
        .digest("hex");

      const provided = Buffer.from(signature, "hex");
      const expected = Buffer.from(expectedSignature, "hex");
      const isValid = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

      logger.info("Razorpay Webhook Validation", { isValid });
      return isValid;
    } catch (error: any) {
      logger.error("Error validating Razorpay webhook", {
        message: error.message,
        stack: error.stack,
      });
      throw new Error("Webhook validation failed");
    }
  }
}

export default new RazorpayService();
