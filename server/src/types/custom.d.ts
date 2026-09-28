import { Request } from "express";

type role = 'ADMIN' | 'USER' | 'COADMIN'

interface AuthPayload {
    id: string;        // Internal Account ID
    uid: string;
    phone?: string | null;
    role: role;
    email?: string;
    name: string;
}

interface AuthRequest extends Request {
    auth: AuthPayload;
}

export interface FirebaseIdentityPayload {
    uid: string;
    email?: string;
    emailVerified: boolean;
}

export interface FirebaseIdentityRequest extends Request {
    firebaseIdentity: FirebaseIdentityPayload;
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
