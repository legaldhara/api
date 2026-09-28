import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { DecodedIdToken, getAuth } from "firebase-admin/auth";

const credential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
  : applicationDefault();
const firebaseApp = getApps()[0] ?? initializeApp({ credential });
const firebaseAuth = getAuth(firebaseApp);

export const verifyFirebaseIdToken = (token: string, checkRevoked = true): Promise<DecodedIdToken> =>
  firebaseAuth.verifyIdToken(token, checkRevoked);

export const createFirebaseCustomToken = (uid: string, claims?: Record<string, unknown>): Promise<string> =>
  firebaseAuth.createCustomToken(uid, claims);

export { firebaseAuth };
