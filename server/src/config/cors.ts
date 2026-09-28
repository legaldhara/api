import cors from "cors";

export const configCorsOrigins = (): string[] => (process.env.CORS_ORIGINS || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean)
  .filter((origin) => process.env.NODE_ENV !== "production" || !/^http:\/\/(localhost|127\.0\.0\.1)/.test(origin));

export const configCors = () => {
  const allowedOrigins = configCorsOrigins();
  return cors({
    origin: (origin, callback) => !origin || allowedOrigins.includes(origin) ? callback(null, true) : callback(new Error("Not allowed by CORS")),
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cache-Control"],
    credentials: true,
    maxAge: 600,
    optionsSuccessStatus: 204,
  });
};
