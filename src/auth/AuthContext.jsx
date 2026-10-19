import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  const refreshSession = useCallback(async () => {
    try {
      const session = await apiFetch('/auth/session');
      setUser(session.user);
    } catch (error) {
      if (error.status !== 401) console.error('Session check failed');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshSession(); }, [refreshSession]);

  const login = useCallback(async (identifier, password) => {
    const result = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) });
    setNotice('');
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } finally { setUser(null); }
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    await apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    setNotice('تم تغيير كلمة المرور بنجاح. سجّل الدخول بكلمة المرور الجديدة.');
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, notice, login, logout, changePassword, refreshSession }), [user, loading, notice, login, logout, changePassword, refreshSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
