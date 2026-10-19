import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from './AuthContext';

const initialVisibility = { current: false, next: false, confirm: false };

function PasswordField({ id, label, autoComplete, value, visible, onChange, onToggle }) {
  return <label htmlFor={id}>{label}<div className="password-input">
    <KeyRound aria-hidden="true" />
    <input id={id} type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={onChange} required minLength="8" maxLength="40" />
    <button type="button" onClick={onToggle} aria-label={`${visible ? 'إخفاء' : 'إظهار'} ${label}`}>{visible ? <EyeOff /> : <Eye />}</button>
  </div></label>;
}

export default function PasswordChangeForm() {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visible, setVisible] = useState(initialVisibility);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggle = (field) => setVisible((current) => ({ ...current, [field]: !current[field] }));
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('كلمتا المرور الجديدتان غير متطابقتين.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('يجب أن تختلف كلمة المرور الجديدة عن الحالية.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return <form className="password-change-form" onSubmit={submit}>
    {error ? <div className="auth-error" role="alert">{error}</div> : null}
    <PasswordField id="current-password" label="كلمة المرور الحالية" autoComplete="current-password" value={currentPassword} visible={visible.current} onChange={(event) => setCurrentPassword(event.target.value)} onToggle={() => toggle('current')} />
    <PasswordField id="new-password" label="كلمة المرور الجديدة" autoComplete="new-password" value={newPassword} visible={visible.next} onChange={(event) => setNewPassword(event.target.value)} onToggle={() => toggle('next')} />
    <PasswordField id="confirm-password" label="تأكيد كلمة المرور الجديدة" autoComplete="new-password" value={confirmPassword} visible={visible.confirm} onChange={(event) => setConfirmPassword(event.target.value)} onToggle={() => toggle('confirm')} />
    <div className="password-policy"><ShieldCheck aria-hidden="true" /><p><strong>متطلبات كلمة المرور</strong><span>من 8 إلى 40 حرفاً، وتحتوي على حرف ورقم على الأقل، ولا تكون كلمة شائعة.</span></p></div>
    <button className="button button--primary password-change-submit" disabled={submitting}>{submitting ? 'جارٍ تغيير كلمة المرور...' : 'تغيير كلمة المرور'}</button>
  </form>;
}
