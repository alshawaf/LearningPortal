export const RELEASE_MODE = import.meta.env.VITE_RELEASE_MODE || 'pilot-practices';
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || '';
export const DATA_RETENTION_DAYS = Number(import.meta.env.VITE_DATA_RETENTION_DAYS || 365);

export function featureEnabled(feature, role) {
  if (role === 'admin') return true;
  if (RELEASE_MODE === 'pilot-practices' && (feature === 'assignments' || feature === 'grades')) return false;
  return true;
}

export function supportHref() {
  return SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}` : null;
}
