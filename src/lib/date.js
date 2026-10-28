const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Keeps academic calendar values date-only. The API normally returns YYYY-MM-DD;
 * the fallback safely normalizes legacy ISO timestamps without exposing a time.
 */
export function formatDateOnly(value) {
  if (!value) return '';

  const text = String(value);
  if (DATE_ONLY_PATTERN.test(text)) return text;

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.split('T')[0] ?? '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Aden',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
}
