import RazorpayService from "../../services/Razorpay";

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface RazorpayFetchedOrder {
  id: string;
  status: string;
  amountPaid: number;
  currency: string;
}

export interface RazorpayCapturedPayment {
  id: string;
  orderId: string;
  status: string;
  amount: number;
  currency: string;
  method?: string;
}

export interface RazorpayRefund {
  id: string;
  status: string;
}

export interface RazorpayGateway {
  createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrder>;
  verifyWebhook(body: Buffer, signature: string): boolean;
  fetchOrder(orderId: string): Promise<RazorpayFetchedOrder>;
  findCapturedPayment(orderId: string): Promise<RazorpayCapturedPayment | null>;
  createFullRefund(paymentId: string, notes: Record<string, string>): Promise<RazorpayRefund>;
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean;
  fetchPayment(paymentId: string): Promise<RazorpayCapturedPayment>;
}

export const razorpayGateway: RazorpayGateway = {
  async createOrder(input) {
    const order = await RazorpayService.createOrder(
      input.amountMinor,
      input.currency,
      input.receipt,
      input.notes,
    );
    return {
      id: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      status: order.status,
    };
  },
  verifyWebhook(body, signature) {
    return RazorpayService.validateWebhook(signature, body);
  },
  async fetchOrder(orderId) {
    const order = await RazorpayService.fetchOrder(orderId);
    return {
      id: order.id,
      status: order.status,
      amountPaid: Number(order.amount_paid),
      currency: order.currency,
    };
  },
  async findCapturedPayment(orderId) {
    const payments = await RazorpayService.fetchPaymentsForOrder(orderId);
    const captured = payments.items.find((payment) => payment.status === "captured");
    if (!captured) return null;
    return {
      id: captured.id,
      orderId: captured.order_id,
      status: captured.status,
      amount: Number(captured.amount),
      currency: captured.currency,
      method: captured.method,
    };
  },
  async createFullRefund(paymentId, notes) {
    const refund = await RazorpayService.initiateRefund(paymentId, undefined, notes);
    return { id: refund.id, status: refund.status };
  },
  verifyPaymentSignature(orderId, paymentId, signature) {
    return RazorpayService.verifyPaymentSignature(orderId, paymentId, signature);
  },
  async fetchPayment(paymentId) {
    const payment = await RazorpayService.fetchPayment(paymentId);
    return {
      id: payment.id,
      orderId: payment.order_id,
      status: payment.status,
      amount: Number(payment.amount),
      currency: payment.currency,
      method: payment.method,
    };
  },
};
