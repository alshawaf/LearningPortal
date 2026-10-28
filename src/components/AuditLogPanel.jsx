import { RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { DataState, EmptyState } from './Ui';
import { apiFetch } from '../lib/api';

const actionLabels = {
  'auth.login.success': 'تسجيل دخول ناجح', 'auth.login.failure': 'محاولة دخول مرفوضة',
  'admin.user.password_reset': 'إعادة تعيين كلمة مرور', 'practice.attempt.view': 'عرض حل طالب',
  'registration.approved': 'قبول طلب تسجيل', 'registration.rejected': 'رفض طلب تسجيل',
};
const formatter = new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeStyle: 'short' });

export default function AuditLogPanel() {
  const [query, setQuery] = useState(''); const [search, setSearch] = useState('');
  const [entries, setEntries] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const value = await apiFetch(`/admin/audit?limit=100${search ? `&action=${encodeURIComponent(search)}` : ''}`); setEntries(value.entries); }
    catch (caught) { setError(caught.message); }
    finally { setLoading(false); }
  }, [search]);
  useEffect(() => { load(); }, [load]);
  const submit = (event) => { event.preventDefault(); setSearch(query.trim()); };
  return <section className="audit-panel">
    <div className="audit-toolbar"><form onSubmit={submit}><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث برمز الحدث، مثل practice أو auth" /><button className="table-action" type="submit">بحث</button></form><button className="table-action" onClick={load}><RefreshCw /> تحديث</button></div>
    <DataState loading={loading} error={error} empty={false}>{!entries.length ? <EmptyState title="لا توجد أحداث مطابقة" text="ستظهر هنا العمليات الإدارية والأمنية المسجلة." /> : <div className="table-shell"><table className="audit-table"><thead><tr><th>الحدث</th><th>المنفذ</th><th>الهدف</th><th>التاريخ</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td><span className="audit-action"><ShieldCheck /> <span><strong>{actionLabels[entry.action] || entry.action}</strong><small>{entry.action}</small></span></span></td><td>{entry.actorName}</td><td>{entry.targetType || '—'}</td><td>{formatter.format(new Date(entry.createdAt))}</td></tr>)}</tbody></table></div>}</DataState>
  </section>;
}
