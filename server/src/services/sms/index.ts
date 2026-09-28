import { DevelopmentSmsProvider } from "./developmentSmsProvider";
import { HttpSmsProvider } from "./httpSmsProvider";
import { SmsDeliverySink, SmsProvider } from "./types";

type SmsEnvironment = Record<string, string | undefined>;

interface SmsProviderDependencies {
  developmentSink?: SmsDeliverySink;
  fetcher?: ConstructorParameters<typeof HttpSmsProvider>[0]["fetcher"];
}

export const createSmsProvider = (
  env: SmsEnvironment = process.env,
  dependencies: SmsProviderDependencies = {},
): SmsProvider => {
  const provider = env.SMS_PROVIDER ?? (env.NODE_ENV === "production" ? undefined : "development");

  if (provider === "development") {
    if (env.NODE_ENV === "production") {
      throw new Error("Development SMS provider is disabled in production");
    }
    return new DevelopmentSmsProvider(dependencies.developmentSink);
  }

  if (provider === "httpsms") {
    const { HTTPSMS_BASE_URL, HTTPSMS_API_TOKEN, HTTPSMS_DEVICE_ID } = env;
    if (!HTTPSMS_BASE_URL || !HTTPSMS_API_TOKEN || !HTTPSMS_DEVICE_ID) {
      throw new Error("httpSMS provider configuration is incomplete");
    }
    return new HttpSmsProvider({
      baseUrl: HTTPSMS_BASE_URL,
      apiToken: HTTPSMS_API_TOKEN,
      deviceId: HTTPSMS_DEVICE_ID,
      fetcher: dependencies.fetcher,
    });
  }

  throw new Error("SMS_PROVIDER must be configured as development or httpsms");
};

export * from "./types";
