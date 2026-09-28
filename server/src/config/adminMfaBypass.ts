export const isAdminMfaBypassEnabled = (): boolean =>
  process.env.NODE_ENV !== "production" && process.env.ALLOW_ADMIN_MFA_BYPASS === "true";
