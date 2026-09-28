export interface OtpSmsMessage {
  phone: string;
  code: string;
  expiresInSeconds: number;
}

export interface SmsProvider {
  sendOtp(message: OtpSmsMessage): Promise<void>;
}

export type SmsDeliverySink = (message: OtpSmsMessage) => Promise<void>;
