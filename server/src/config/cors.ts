import 'dotenv/config';
import cors from 'cors';

export const configCors = () => {
  // Read and split all allowed origins from .env
//   const allowedOrigins = process.env.CORS_ORIGINS
//     ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
//     : [];

     const allowedOrigins = [
        'http://localhost:5173',
        "http://localhost:3000",
        "https://legaldhara.in",
        "https://legaldhara.com",
        "https://www.legaldhara.com",
        "https://wwww.legaldhara.in"
     ]

  return cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept-Version',
      'Cache-Control',
      'Expires',
      'Pragma',
      'x-requested-with',
    ],
    credentials: true,
    preflightContinue: false,
    maxAge: 600,
    optionsSuccessStatus: 204,
  });
};
