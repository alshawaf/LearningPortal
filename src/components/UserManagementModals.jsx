import { ShieldCheck, UserRoundPen, X } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { AcademicLevelFields } from './CreateModal';
import Select from './Select';

const roleLabels = { admin: 'مدير', instructor: 'أستاذ', student: 'طالب' };
const statusLabels = { active: 'نشط', suspended: 'موقوف مؤقتًا', disabled: 'معطّل' };

export function EditUserModal({ person, isSelf, departments, onClose, onSaved }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [role, setRole] = useState(person.role);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      await apiFetch(`/admin/users/${person.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: values.get('displayName'), email: values.get('email'),
          phone: values.get('phone'), role: values.get('role'),
          academicLevelId: role === 'student' ? values.get('academicLevelId') || null : null,
        }),
      });
      await onSaved('تم تحديث بيانات الحساب بنجاح.', isSelf);
    } catch (requestError) {
      setError(requestError.message || 'تعذر تحديث بيانات الحساب.');
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
    <header><div><small>إدارة الحساب</small><h2 id="edit-user-title"><UserRoundPen size={20} /> تعديل بيانات المستخدم</h2></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X /></button></header>
    <form onSubmit={submit}>
      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      <label>الاسم الكامل<input name="displayName" defaultValue={person.displayName} required minLength="2" maxLength="120" /></label>
      <label>البريد الإلكتروني<input name="email" type="email" defaultValue={person.email} required /></label>
      <label>رقم الجوال<input name="phone" type="tel" dir="ltr" inputMode="tel" defaultValue={person.phone ?? ''} required placeholder="+967777123456" /></label>
      <label>الدور<Select name="role" ariaLabel="الدور" value={role} onValueChange={setRole} disabled={isSelf} options={[{ value: 'student', label: 'طالب' }, { value: 'instructor', label: 'أستاذ' }, { value: 'admin', label: 'مدير' }]} />{isSelf ? <><input type="hidden" name="role" value={person.role} /><small className="modal-note">لا يمكن تغيير دور حسابك من جلستك الحالية.</small></> : null}</label>
      {role === 'student' ? <AcademicLevelFields departments={departments} initialDepartmentId={person.departmentId ?? ''} initialSpecializationId={person.specializationId ?? ''} initialLevelId={person.levelId ?? ''} /> : null}
      <footer><button type="button" className="button button--outline" onClick={onClose}>إلغاء</button><button className="button button--primary" disabled={submitting}>{submitting ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}</button></footer>
    </form>
  </section></div>;
}

export function ChangeUserStatusModal({ person, onClose, onSaved }) {
  const [nextStatus, setNextStatus] = useState(person.status === 'active' ? 'suspended' : 'active');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await apiFetch(`/admin/users/${person.id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: nextStatus }),
      });
      await onSaved(`تم تغيير حالة الحساب إلى «${statusLabels[nextStatus]}».`);
    } catch (requestError) {
      setError(requestError.message || 'تعذر تغيير حالة الحساب.');
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="modal-backdrop" role="presentation"><section className="modal modal--compact" role="dialog" aria-modal="true" aria-labelledby="status-user-title">
    <header><div><small>إدارة الوصول</small><h2 id="status-user-title"><ShieldCheck size={20} /> تغيير حالة الحساب</h2></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X /></button></header>
    <form onSubmit={submit}>
      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      <p className="modal-copy">المستخدم: <strong>{person.displayName}</strong><br />الحالة الحالية: {statusLabels[person.status]}</p>
      <label>الحالة الجديدة<Select ariaLabel="الحالة الجديدة" value={nextStatus} onValueChange={setNextStatus} options={[{ value: 'active', label: 'نشط' }, { value: 'suspended', label: 'موقوف مؤقتًا' }, { value: 'disabled', label: 'معطّل' }]} /></label>
      <p className="modal-warning">إيقاف الحساب أو تعطيله سيمنع تسجيل الدخول ويبطل جلساته الحالية فورًا.</p>
      <footer><button type="button" className="button button--outline" onClick={onClose}>إلغاء</button><button className="button button--danger" disabled={submitting || nextStatus === person.status}>{submitting ? 'جارٍ التحديث...' : 'تأكيد تغيير الحالة'}</button></footer>
    </form>
  </section></div>;
}

export { roleLabels, statusLabels };
