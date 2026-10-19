import { useState } from 'react';
import { Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react';
import Brand from '../components/Brand';
import { useAuth } from './AuthContext';

export default function LoginPage({ onRegister }) {
  const { login, notice } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try { await login(identifier, password); }
    catch (requestError) { setError(requestError.message); }
    finally { setSubmitting(false); }
  };

  return <main className="login-page">
    <section className="login-brand-panel login-brand-panel--minimal">
      <Brand />
    </section>
    <section className="login-form-panel">
      <form className="login-form" onSubmit={submit}>
        <header><h2>تسجيل الدخول</h2><p>استخدم حسابك المؤسسي للوصول إلى المنصة.</p></header>
        {notice ? <div className="auth-success" role="status">{notice}</div> : null}
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        <label><span>البريد الإلكتروني أو رقم الجوال</span><div className="auth-input"><UserRound /><input type="text" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required placeholder="name@college.edu أو +967777123456" /></div></label>
        <label><span>كلمة المرور</span><div className="auth-input"><LockKeyhole /><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength="8" maxLength="40" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
        <button className="button button--primary login-submit" disabled={submitting}>{submitting ? 'جارٍ التحقق...' : 'دخول آمن'}</button>
        <div className="auth-divider"><span>أو</span></div>
        <button type="button" className="button button--outline login-register" onClick={onRegister}><UserRound /> تسجيل طالب</button>
        <p className="login-help">إذا تعذر الدخول، تواصل مع مسؤول المنصة. لا تشارك كلمة مرورك مع أي شخص.</p>
      </form>
    </section>
  </main>;
}
