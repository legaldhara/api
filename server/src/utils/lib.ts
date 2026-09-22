import { Request, Response, NextFunction } from "express";


export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<Response | void>) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
}

export function formatToIndianNumber(phone: string): string {
    // Remove all non-digit characters (optional step) 
    const digits = phone.replace(/\D/g, '');

    // If number already starts with '91' and is 12 digits (with country code but missing '+')
    if (digits.startsWith('91') && digits.length === 12) {
        return `+${digits}`;
    }

    // If number is 10 digits, add '+91'
    if (digits.length === 10) {
        return `+91${digits}`;
    }

    // If it already includes +91 correctly
    if (phone.startsWith('+91')) {
        return phone;
    }

    // Default fallback (return as-is)
    return phone;
}

export function getTokenFromHeader(req: Request): string | null {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }

  return null; // No valid token found
}


 export function calculateDiscountPercent(originalPrice: number, discountPrice: number): string {
    if (originalPrice <= 0) return "Invalid original price";

    const discount = ((originalPrice - discountPrice) / originalPrice) * 100;
    return discount.toFixed(2);
  }





