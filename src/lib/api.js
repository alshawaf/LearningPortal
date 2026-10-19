const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

function readCookie(...names) {
  const values = new Map(document.cookie.split('; ').filter(Boolean).map((item) => {
    const index = item.indexOf('=');
    return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
  }));
  for (const name of names) if (values.has(name)) return values.get(name);
  return null;
}

export async function apiFetch(path, options = {}) {
  const method = options.method || 'GET';
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    const csrf = readCookie('mc_csrf', '__Host-mc_csrf');
    if (csrf) headers.set('x-csrf-token', csrf);
  }
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options, method, headers, credentials: 'include',
    });
  } catch {
    const error = new Error('تعذر الاتصال بخادم المنصة. حاول مرة أخرى لاحقًا.');
    error.code = 'NETWORK_ERROR';
    throw error;
  }
  const hasJson = response.headers.get('content-type')?.includes('application/json');
  const body = hasJson ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(body?.error?.message || 'تعذر الاتصال بالخادم.');
    error.code = body?.error?.code;
    error.status = response.status;
    error.details = body?.error?.details;
    throw error;
  }
  return body;
}
