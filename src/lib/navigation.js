import { featureEnabled } from '../config/features';

const DEFAULT_PAGE = 'dashboard';

const rolePages = {
  admin: new Set(['dashboard', 'courses', 'academic-delivery', 'practices', 'assignments', 'student-activity', 'academic-structure', 'students', 'settings']),
  teacher: new Set(['dashboard', 'courses', 'practices', 'assignments', 'student-activity', 'students', 'settings']),
  student: new Set(['dashboard', 'courses', 'practices', 'assignments', 'grades', 'settings']),
};

const pagePaths = {
  dashboard: '/',
  courses: '/courses',
  'academic-delivery': '/academic-delivery',
  practices: '/practices',
  assignments: '/assignments',
  grades: '/grades',
  'academic-structure': '/academic-structure',
  'student-activity': '/student-activity',
  students: '/students',
  settings: '/settings',
};

const pathPages = new Map(Object.entries(pagePaths).map(([page, path]) => [path, page]));

function normalizePath(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  return `/${decodedPath}`.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
}

function legacyPageFromHash(hash) {
  if (!hash.startsWith('#/')) return null;
  try {
    return decodeURIComponent(hash.slice(2).split(/[/?]/, 1)[0] || '') || DEFAULT_PAGE;
  } catch {
    return null;
  }
}

export function pageFromLocation(location = window.location) {
  const legacyPage = legacyPageFromHash(location.hash);
  if (legacyPage) return legacyPage;

  const path = normalizePath(location.pathname);
  return pathPages.get(path) || null;
}

export function isPageAllowed(page, role) {
  if (page === 'assignments' && !featureEnabled('assignments', role)) return false;
  if (page === 'grades' && !featureEnabled('grades', role)) return false;
  return rolePages[role]?.has(page) ?? false;
}

export function pagePath(page) {
  return pagePaths[page] || pagePaths[DEFAULT_PAGE];
}

export function writePagePath(page, { replace = false } = {}) {
  const pathname = pagePath(page);
  if (window.location.pathname === pathname && !window.location.hash) return;

  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({ page }, '', `${pathname}${window.location.search}`);
}

export { DEFAULT_PAGE };
