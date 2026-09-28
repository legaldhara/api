import { OtpSmsMessage, SmsProvider } from "./types";

type FetchResponse = Pick<Response, "ok" | "status">;
type Fetcher = (input: string, init: RequestInit) => Promise<FetchResponse>;

interface HttpSmsProviderOptions {
  baseUrl: string;
  apiToken: string;
  deviceId: string;
  fetcher?: Fetcher;
}

export class HttpSmsProvider implements SmsProvider {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly deviceId: string;
  private readonly fetcher: Fetcher;

  constructor(options: HttpSmsProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiToken = options.apiToken;
    this.deviceId = options.deviceId;
    this.fetcher = options.fetcher ?? fetch;
  }

  async sendOtp(message: OtpSmsMessage): Promise<void> {
    const expiryMinutes = Math.ceil(message.expiresInSeconds / 60);
    let response: FetchResponse;

    try {
      response = await this.fetcher(`${this.baseUrl}/messages/send`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-api-key": this.apiToken,
        },
        body: JSON.stringify({
          from: this.deviceId,
          to: message.phone,
          content: `LegalDhara code: ${message.code}. Valid for ${expiryMinutes} min.`,
        }),
      });
    } catch {
      throw new Error("SMS delivery request failed");
    }

    if (!response.ok) {
      throw new Error(`SMS delivery failed with status ${response.status}`);
    }
  }
}
