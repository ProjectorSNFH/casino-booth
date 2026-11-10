import { randomBytes } from 'node:crypto';

const b64 = () => randomBytes(32).toString('base64');
console.log(`PII_ENC_KEY=${b64()}`);
console.log(`SID_HMAC_KEY=${b64()}`);