const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

function toAsciiDigits(value: string): string {
  return [...value].map((character) => {
    const arabicIndex = ARABIC_DIGITS.indexOf(character);
    if (arabicIndex >= 0) return String(arabicIndex);
    const easternIndex = EASTERN_ARABIC_DIGITS.indexOf(character);
    return easternIndex >= 0 ? String(easternIndex) : character;
  }).join('');
}

export function normalizePhone(value: string): string | null {
  let phone = toAsciiDigits(value.trim()).replace(/[\s\-().]/g, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  else if (/^967\d{9}$/.test(phone)) phone = `+${phone}`;
  else if (/^07\d{8}$/.test(phone)) phone = `+967${phone.slice(1)}`;
  else if (/^7\d{8}$/.test(phone)) phone = `+967${phone}`;
  return E164_PATTERN.test(phone) ? phone : null;
}

export function normalizeLoginIdentifier(value: string): string | null {
  const identifier = value.trim();
  if (identifier.includes('@')) {
    const email = identifier.toLowerCase();
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }
  return normalizePhone(identifier);
}
