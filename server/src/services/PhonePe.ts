import { StandardCheckoutClient, Env, RefundRequest, StandardCheckoutPayRequest, PhonePeException, MetaInfo } from 'pg-sdk-node';
import { logger } from '../utils/logger';

class PhonepeService {
    private client: ReturnType<typeof StandardCheckoutClient.getInstance>;
    private callbackUsername: string;
    private callbackPassword: string;

    constructor() {
        const isProd = process.env.NODE_ENV === 'production';
        const env = isProd ? Env.PRODUCTION : Env.SANDBOX;
        // const env = Env.SANDBOX

        const clientId = process.env.PHONEPE_CLIENT_ID!;
        const clientSecret = process.env.PHONEPE_CLIENT_SECRET!;
        const clientVersion = parseInt(process.env.PHONEPE_CLIENT_VERSION || '1', 10);

        this.callbackUsername = process.env.PHONEPE_CALLBACK_USERNAME!;
        this.callbackPassword = process.env.PHONEPE_CALLBACK_PASSWORD!;

        if (!clientId || !clientSecret) {
            throw new Error('PhonePe credentials are missing.');
        }

        this.client = StandardCheckoutClient.getInstance(clientId, clientSecret, clientVersion, env);
    }

    async initiatePayment(amount: number, merchantOrderId: string, redirectUrl: string, additionalInfo?: Record<string, string>) {

        const metaInfo = MetaInfo.builder()
            .udf1(additionalInfo?.udf1 || '')
            .udf2(additionalInfo?.udf2 || '')
            .udf3(additionalInfo?.udf3 || '')
            .udf4(additionalInfo?.udf4 || '')
            .udf5(additionalInfo?.udf5 || '')
            .build();

        try {
            const request = StandardCheckoutPayRequest.builder()
                .merchantOrderId(merchantOrderId)
                .amount(amount)
                .redirectUrl(redirectUrl)
                .metaInfo(metaInfo)
                .build();

            return await this.client.pay(request);
        } catch (error) {
            if (error instanceof PhonePeException) {
                console.error('PhonePe initiate payment failed:', error.message);
                throw error; // Re-throw for higher-level handling
            } else {
                console.error('Unexpected error during initiate payment:', error);
                throw new Error('Unexpected initiate payment error');
            }
        }
    }

    async checkOrderStatus(merchantOrderId: string) {
        try {
            return await this.client.getOrderStatus(merchantOrderId);
        } catch (error) {
            if (error instanceof PhonePeException) {
                console.error('PhonePe order status failed:', error.message);
                throw error; // Re-throw for higher-level handling
            } else {
                console.error('Unexpected error during order status:', error);
                throw new Error('Unexpected order status error');
            }
        }
    }

    async validateCallback(authorization: string, responseBody: string | Buffer) {
        try {
            const bodyString = typeof responseBody === 'string' ? responseBody : responseBody.toString('utf8');
            const result = await this.client.validateCallback(
                this.callbackUsername,
                this.callbackPassword,
                authorization,
                bodyString
            );
            logger.info('Callback Response', result)
            return result;

        } catch (error: any) {
            logger.error('Callback validation error:', {
                error: error.message,
                stack: error.stack,
                type: error.constructor.name
            });

            if (error instanceof PhonePeException) {
                console.error('PhonePe callback validation failed:', error.message);
                throw error;
            } else {
                console.error('Unexpected error during callback validation:', error);
                throw new Error('Unexpected callback validation error');
            }
        }
    }

    async initiateRefund(amount: number, originalMerchantOrderId: string, refundId: string) {
        try {
            const request = RefundRequest.builder()
                .amount(amount)
                .merchantRefundId(refundId)
                .originalMerchantOrderId(originalMerchantOrderId)
                .build();

            return await this.client.refund(request);
        } catch (error) {
            if (error instanceof PhonePeException) {
                console.error('PhonePe initiate refund failed:', error.message);
                throw error; // Re-throw for higher-level handling
            } else {
                console.error('Unexpected error during initiate refund:', error);
                throw new Error('Unexpected callback initiate refund');
            }
        }
    }
}

export default new PhonepeService();
