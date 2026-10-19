import { CheckCircle2, Clock3, FilePenLine, Search, ShieldAlert, UserCheck, UserRoundSearch, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { AcademicLevelFields } from './CreateModal';
import Select from './Select';
import { DataState } from './Ui';

const statusLabels = { pending: 'بانتظار المراجعة', changes_requested: 'مطلوب تعديل', approved: 'تمت الموافقة', rejected: 'مرفوض' };
const statusOptions = [{ value: 'all', label: 'جميع الطلبات' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))];
const dateFormatter = new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeStyle: 'short' });

export default function RegistrationRequestsPanel({ departments, onUserApproved }) {
  const [requests, setRequests] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('pending'); const [selected, setSelected] = useState(null); const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await apiFetch('/registration/admin'); setRequests(result.requests); }
    catch (caught) { setError(caught.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => requests.filter((request) => {
    const matchesStatus = status === 'all' || request.status === status;
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || `${request.displayName} ${request.email} ${request.phone} ${request.studentNumber ?? ''}`.toLowerCase().includes(needle);
    return matchesStatus && matchesQuery;
  }), [query, requests, status]);
  const pendingCount = requests.filter((request) => request.status === 'pending').length;

  const saved = async (message, approved = false) => {
    await load(); if (approved) await onUserApproved(); setSelected(null); setNotice(message);
    window.setTimeout(() => setNotice(''), 3500);
  };

  return <section className="registration-requests-panel">
    <header className="registration-requests-heading"><div><span><UserRoundSearch /></span><div><h2>طلبات تسجيل الطلاب</h2><p>راجع الهوية والمسار الأكاديمي، وعدّل البيانات عند الحاجة قبل اعتماد الحساب.</p></div></div><strong>{pendingCount} بانتظار المراجعة</strong></header>
    <div className="filterbar registration-request-filters"><label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالاسم أو البريد أو الرقم الجامعي" /></label><Select ariaLabel="تصفية طلبات التسجيل" value={status} onValueChange={setStatus} options={statusOptions} /></div>
    <DataState loading={loading} error={error} empty={!filtered.length} emptyMessage="لا توجد طلبات مطابقة.">
      <div className="registration-request-list">{filtered.map((request) => <article key={request.id} className="registration-request-card">
        <div className="registration-request-person"><i>{request.displayName[0]}</i><div><strong>{request.displayName}</strong><small>{request.email} · <span dir="ltr">{request.phone}</span></small></div></div>
        <div><span>المسار الأكاديمي</span><strong>{request.specializationName} · {request.levelName}</strong><small>{request.departmentName}</small></div>
        <div><span>تاريخ التقديم</span><strong>{dateFormatter.format(new Date(request.createdAt))}</strong><small>{request.studentNumber ? `الرقم الجامعي: ${request.studentNumber}` : 'دون رقم جامعي'}</small></div>
        <span className={`registration-request-status registration-request-status--${request.status}`}>{statusLabels[request.status] ?? request.status}</span>
        <button className="table-action" onClick={() => setSelected(request)}><FilePenLine /> {request.status === 'pending' || request.status === 'changes_requested' ? 'مراجعة الطلب' : 'عرض الطلب'}</button>
      </article>)}</div>
    </DataState>
    {selected ? <RegistrationReviewModal request={selected} departments={departments} onClose={() => setSelected(null)} onSaved={saved} /> : null}
    {notice ? <div className="toast" role="status">{notice}</div> : null}
  </section>;
}

function RegistrationReviewModal({ request, departments, onClose, onSaved }) {
  const editable = request.status === 'pending' || request.status === 'changes_requested';
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(''); const [reason, setReason] = useState(request.decisionReason ?? '');
  const saveDetails = async (event) => {
    event.preventDefault(); setSubmitting(true); setError(''); const values = new FormData(event.currentTarget);
    try {
      await apiFetch(`/registration/admin/${request.id}`, { method: 'PATCH', body: JSON.stringify({
        displayName: values.get('displayName'), email: values.get('email'), phone: values.get('phone'),
        studentNumber: values.get('studentNumber') || '', academicLevelId: values.get('academicLevelId'),
      }) });
      await onSaved('تم حفظ تعديلات طلب التسجيل.');
    } catch (caught) { setError(caught.message); setSubmitting(false); }
  };
  const decide = async (decision) => {
    setSubmitting(true); setError('');
    try {
      const result = await apiFetch(`/registration/admin/${request.id}/decision`, { method: 'POST', body: JSON.stringify({ decision, reason: decision === 'approved' ? null : reason }) });
      await onSaved(result.message, decision === 'approved');
    } catch (caught) { setError(caught.message); setSubmitting(false); }
  };

  return <div className="modal-backdrop" role="presentation"><section className="modal modal--registration-review" role="dialog" aria-modal="true" aria-labelledby="registration-review-title">
    <header><div><small>مراجعة طلب طالب</small><h2 id="registration-review-title">{request.displayName}</h2></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X /></button></header>
    <div className="registration-review-layout">
      <form id="registration-review-form" className="registration-review-form" onSubmit={saveDetails}>
        <div className="registration-review-section-title"><FilePenLine /><div><h3>بيانات الطالب</h3><p>يمكن للإدارة تصحيح البيانات قبل اتخاذ القرار.</p></div></div>
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        <div className="registration-review-fields">
          <label>الاسم الكامل<input name="displayName" defaultValue={request.displayName} required minLength="2" maxLength="120" disabled={!editable} /></label>
          <label>الرقم الجامعي<input name="studentNumber" defaultValue={request.studentNumber ?? ''} maxLength="32" dir="ltr" disabled={!editable} /></label>
          <label>البريد الإلكتروني<input name="email" type="email" defaultValue={request.email} required dir="ltr" disabled={!editable} /></label>
          <label>رقم الجوال<input name="phone" type="tel" defaultValue={request.phone} required dir="ltr" disabled={!editable} /></label>
          {editable ? <AcademicLevelFields departments={departments} initialDepartmentId={request.departmentId} initialSpecializationId={request.specializationId} initialLevelId={request.levelId} /> : <><label>الدائرة<input value={request.departmentName} disabled readOnly /></label><label>التخصص<input value={request.specializationName} disabled readOnly /></label><label>المستوى<input value={request.levelName} disabled readOnly /></label></>}
        </div>
        {editable ? <button className="button button--outline registration-save-details" disabled={submitting}><FilePenLine /> حفظ تعديلات البيانات</button> : null}
      </form>
      <aside className="registration-decision-panel">
        <div className="registration-review-section-title"><ShieldAlert /><div><h3>قرار المراجعة</h3><p>سيظهر سبب طلب التعديل أو الرفض للطالب.</p></div></div>
        <dl><div><dt>حالة الطلب</dt><dd><span className={`registration-request-status registration-request-status--${request.status}`}>{statusLabels[request.status] ?? request.status}</span></dd></div><div><dt>وقت التقديم</dt><dd>{dateFormatter.format(new Date(request.createdAt))}</dd></div>{request.reviewedByName ? <div><dt>راجعه</dt><dd>{request.reviewedByName}</dd></div> : null}</dl>
        {editable ? <><label>ملاحظة القرار<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength="500" placeholder="مطلوبة عند طلب تعديل البيانات أو رفض الطلب" /></label><div className="registration-decision-actions"><button className="button button--primary" disabled={submitting} onClick={() => decide('approved')}><UserCheck /> موافقة وتفعيل الحساب</button><button className="button button--outline" disabled={submitting || reason.trim().length < 3} onClick={() => decide('changes_requested')}>طلب تعديل</button><button className="button button--danger" disabled={submitting || reason.trim().length < 3} onClick={() => decide('rejected')}>رفض الطلب</button></div></> : request.decisionReason ? <div className="registration-admin-note"><strong>ملاحظة القرار</strong><p>{request.decisionReason}</p></div> : null}
      </aside>
    </div>
    <footer><span>تُسجل كل تعديلات وقرارات الإدارة في سجل التدقيق.</span><button className="button button--outline" onClick={onClose}>إغلاق</button></footer>
  </section></div>;
}
