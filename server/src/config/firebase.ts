import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import firebaseAdmin from 'firebase-admin';
import { getAuth } from "firebase-admin/auth";

import { logger } from '../utils/logger';

const isProd = process.env.NODE_ENV === 'production';

const firebaseCredPath = isProd
    ? (process.env.FIREBASE_CRED_PATH || '/etc/secrets/firebase-key.json') // for Render production
    : path.join(__dirname, '../../cert/firebase-key.json');

try {
    if (!fs.existsSync(firebaseCredPath)) {
        logger.error(`[Firebase] Key file not found at ${firebaseCredPath}`);
    } else {
        console.info(`[Firebase] Key file found at ${firebaseCredPath}`);
    }

    // const serviceAccount = JSON.parse(fs.readFileSync(firebaseCredPath, 'utf8'));

    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(firebaseCredPath),
        });
        console.info(`[Firebase] Initialized`);
    } else {
        console.info('[Firebase] Firebase already initialized');
    }
} catch (error) {
    logger.error('[Firebase] Initialization failed:', error);
}

const verifyFirebaseToken = async (token: string) => {
    try {
        const decoded = await firebaseAdmin.auth().verifyIdToken(token);

        if (!decoded.phone_number) {
            throw new Error("Phone Number Missing");
        }

        return {
            uid: decoded.uid,
            phone: decoded.phone_number,
            exp: decoded.exp,
            sub: decoded.sub,
        };
    } catch (error) {
        throw new Error("Invalid Firebase Token");
    }
};

export { firebaseAdmin, verifyFirebaseToken, getAuth };