import { Request } from "express";
import { JwtPayload } from "jsonwebtoken";

type role = 'ADMIN' | 'USER' | 'COADMIN'

interface AuthPayload extends JwtPayload {
    id: string;        // Internal Account ID
    domain: string;
    sub?: string;      // Firebase/Otpless UID
    phone?: string;
    exp: number;
    role: role;
    email?: string;
    name: string;
}

interface AuthRequest extends Request {
    auth: AuthPayload;
}

// MulterRequest
interface MulterRequest extends Request {
    files?: Express.Multer.File[];
    folder?: string;
}

interface Pagination {
    role?: 'user' | 'distributor';
    page?: string;
    limit?: string;
    search?: string;
    sortBy?: string;
    order?: 'asc' | 'desc';
}

