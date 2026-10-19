import { hash, verify, Algorithm } from '@node-rs/argon2';

const commonPasswords = new Set([
  'password', 'password123', '123456789', 'qwerty123', 'admin123',
  'letmein123', 'welcome123', 'iloveyou', '111111111111',
]);

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 40;

export function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) errors.push('يجب ألا تقل كلمة المرور عن 8 أحرف.');
  if (password.length > PASSWORD_MAX_LENGTH) errors.push('يجب ألا تزيد كلمة المرور عن 40 حرفاً.');
  if (!/[\p{L}]/u.test(password) || !/\d/.test(password)) errors.push('يجب أن تحتوي كلمة المرور على حروف وأرقام.');
  if (commonPasswords.has(password.toLowerCase())) errors.push('كلمة المرور شائعة وسهلة التخمين.');
  return errors;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
    outputLen: 32,
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
