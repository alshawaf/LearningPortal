import { ClipboardList, Pencil, Search, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataState, PageHeading, PrimaryButton } from '../components/Ui';
import { ChangeUserStatusModal, EditUserModal, roleLabels, statusLabels } from '../components/UserManagementModals';
import Select from '../components/Select';
import RegistrationRequestsPanel from '../components/RegistrationRequestsPanel';

export default function PeoplePage({ admin = false, people, departments = [], loading, error, onCreate, onRefresh, currentUserId, onCurrentUserUpdated }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [editingPerson, setEditingPerson] = useState(null);
  const [statusPerson, setStatusPerson] = useState(null);
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState('accounts');
  const filtered = useMemo(() => people.filter((person) => {
    const matchesQuery = `${person.displayName} ${person.email} ${person.phone ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesStatus = status === 'all' || person.status === status;
    const matchesRole = roleFilter === 'all' || person.role === roleFilter;
    return matchesQuery && matchesStatus && matchesRole;
  }), [people, query, roleFilter, status]);

  const handleSaved = async (message, currentUserUpdated = false) => {
    await onRefresh();
    if (currentUserUpdated) await onCurrentUserUpdated();
    setEditingPerson(null);
    setStatusPerson(null);
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3000);
  };

  return <div className="stack-lg"><PageHeading title={admin ? 'المستخدمون' : 'طلاب المقررات'} description={admin ? 'إدارة الحسابات ومراجعة طلبات تسجيل الطلاب.' : 'الطلاب المسجلون فعليًا في مقرراتك.'} action={admin && section === 'accounts' ? <PrimaryButton icon={false} onClick={onCreate}><UserPlus size={18} /> إضافة مستخدم</PrimaryButton> : null} />
    {admin ? <nav className="people-sections" aria-label="أقسام إدارة المستخدمين"><button className={section === 'accounts' ? 'is-active' : ''} onClick={() => setSection('accounts')}><Users /> الحسابات</button><button className={section === 'registrations' ? 'is-active' : ''} onClick={() => setSection('registrations')}><ClipboardList /> طلبات التسجيل</button></nav> : null}
    {admin && section === 'registrations' ? <RegistrationRequestsPanel departments={departments} onUserApproved={onRefresh} /> : <>
    <div className="filterbar"><label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالاسم أو البريد أو الجوال" /></label><Select ariaLabel="تصفية حسب نوع المستخدم" value={roleFilter} onValueChange={setRoleFilter} options={[{ value: 'all', label: 'جميع الأنواع' }, { value: 'admin', label: 'مدير' }, { value: 'instructor', label: 'أستاذ' }, { value: 'student', label: 'طالب' }]} /><Select ariaLabel="تصفية حسب حالة الحساب" value={status} onValueChange={setStatus} options={[{ value: 'all', label: 'جميع الحالات' }, { value: 'active', label: 'نشط' }, { value: 'suspended', label: 'موقوف' }, { value: 'disabled', label: 'معطّل' }]} /></div>
    <DataState loading={loading} error={error} empty={!filtered.length}>
      <div className="table-shell"><table className={admin ? 'users-table users-table--admin' : 'users-table'}><thead><tr><th>الاسم</th><th>البريد الإلكتروني</th><th>رقم الجوال</th><th>الدور</th><th>المقررات</th><th>آخر دخول</th><th>الحالة</th>{admin ? <th>الإجراءات</th> : null}</tr></thead><tbody>{filtered.map((person) => <tr key={person.id}><td><span className="person"><i>{person.displayName[0]}</i><strong>{person.displayName}</strong></span></td><td>{person.email}</td><td dir="ltr">{person.phone ?? 'غير مضاف'}</td><td>{roleLabels[person.role]}</td><td>{person.courseCount}</td><td>{person.lastLoginAt ? new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium' }).format(new Date(person.lastLoginAt)) : 'لم يسجل الدخول'}</td><td><span className={`status ${person.status === 'active' ? 'status--success' : person.status === 'disabled' ? 'status--muted' : 'status--warning'}`}>{statusLabels[person.status]}</span></td>{admin ? <td><UserActions isSelf={person.id === currentUserId} onEdit={() => setEditingPerson(person)} onStatus={() => setStatusPerson(person)} /></td> : null}</tr>)}</tbody></table></div>
    </DataState>
    {editingPerson ? <EditUserModal person={editingPerson} isSelf={editingPerson.id === currentUserId} departments={departments} onClose={() => setEditingPerson(null)} onSaved={handleSaved} /> : null}
    {statusPerson ? <ChangeUserStatusModal person={statusPerson} onClose={() => setStatusPerson(null)} onSaved={handleSaved} /> : null}
    {notice ? <div className="toast" role="status">{notice}</div> : null}
    </>}
  </div>;
}

function UserActions({ isSelf, onEdit, onStatus }) {
  return <div className="user-actions"><button className="table-action" onClick={onEdit}><Pencil size={15} /> تعديل</button><button className="table-action table-action--status" onClick={onStatus} disabled={isSelf} title={isSelf ? 'لا يمكن تغيير حالة حسابك الحالي' : 'تغيير حالة الحساب'}><ShieldCheck size={15} /> الحالة</button></div>;
}
