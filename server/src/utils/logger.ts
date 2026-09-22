import { NextFunction, Request, Response } from "express";
import winston from "winston";

export const logger = winston.createLogger({
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: "server" },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            ),
        }),
        new winston.transports.File({ filename: "error.log", level: "error" }),
        new winston.transports.File({ filename: "combined.log" }),
    ],
});

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
    const startHrTime = process.hrtime();

    res.on('finish', () => {
        const elapsedHrTime = process.hrtime(startHrTime);
        const elapsedMs = (elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6).toFixed(3);

        // Get IP (try x-forwarded-for first for proxies)
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;

        // Build log line
        const logLine = [
            `IP: ${ip}`,
            `Method: /${req.method}`,
            `URL: ${req.originalUrl}`,
            `Status: ${res.statusCode}`,
            `ResponseTime: ${elapsedMs} ms`
        ].join(' | ');

        logger.info(logLine);
    });

    next();
}



export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error({
        message: err.message,
        stack: err.stack || '',
        method: req.method,
        url: req.originalUrl,
        statusCode: err.status || 500,
        ip: req.ip,
        ...(err.error && { error: err.error.message }), // log nested error if provided
    });

    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error',
        ...(err.flag && { flag: err.flag }),
    });
};
