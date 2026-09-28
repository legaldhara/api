import { OtpSmsMessage, SmsDeliverySink, SmsProvider } from "./types";

export class DevelopmentSmsProvider implements SmsProvider {
  constructor(private readonly sink: SmsDeliverySink = async () => undefined) {}

  async sendOtp(message: OtpSmsMessage): Promise<void> {
    await this.sink(message);
  }
}
