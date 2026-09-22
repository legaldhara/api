import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger';

const isProd = process.env.NODE_ENV === 'production';

const keysBasePath = isProd
  ? (process.env.ENCRYPTION_KEYS_PATH || '/etc/secrets') // Path for Render (Production)
  : path.join(__dirname, '../../cert'); // Local path

const publicKeyPath = path.join(keysBasePath, 'public-key.pem');
const privateKeyPath = path.join(keysBasePath, 'private-key.pem');

let publicKey: string;
let privateKey: string;

try {
  if (!fs.existsSync(publicKeyPath)) {
    logger.error(`[RSA] Public key not found at ${publicKeyPath}`);
  } else {
    publicKey = fs.readFileSync(publicKeyPath, 'utf8');
    console.info(`[RSA] Loaded public key from ${publicKeyPath}`);
  }

  if (!fs.existsSync(privateKeyPath)) {
    logger.error(`[RSA] Private key not found at ${privateKeyPath}`);
  } else {
    privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    console.info(`[RSA] Loaded private key from ${privateKeyPath}`);
  }
} catch (error) {
  logger.error('[RSA] Failed to load keys:', error);
}

export const encryptRSA = (data: object): string => {
  const stringData = JSON.stringify(data);
  const encryptedBuffer = crypto.publicEncrypt(publicKey, Buffer.from(stringData));
  return encryptedBuffer.toString('base64');
};

export const decryptRSA = (data: string): any => {
  const decryptedBuffer = crypto.privateDecrypt(privateKey, Buffer.from(data, 'base64'));
  return JSON.parse(decryptedBuffer.toString());
};