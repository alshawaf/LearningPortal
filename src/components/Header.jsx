import { Bell, LogOut, Menu, Search } from 'lucide-react';
import Brand from './Brand';
import { useMemo, useState } from 'react';

const roleNames = { student: 'طالب', teacher: 'أستاذ', admin: 'مدير النظام' };

export default function Header({ role, user, courses = [], assignments = [], assignmentsEnabled = true, onNavigate, onOpenAssignment, onLogout, onMenuToggle }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return [
      ...courses.filter((item) => `${item.code} ${item.title}`.toLowerCase().includes(normalized)).map((item) => ({ ...item, kind: 'course' })),
      ...(assignmentsEnabled ? assignments.filter((item) => `${item.title} ${item.courseTitle}`.toLowerCase().includes(normalized)).map((item) => ({ ...item, kind: 'assignment' })) : []),
    ].slice(0, 6);
  }, [assignments, courses, query]);
  return (
    <header className="topbar">
      <button className="icon-button menu-button" onClick={onMenuToggle} aria-label="فتح القائمة"><Menu size={21} /></button>
      <Brand />
      <label className="search-box">
        <Search size={18} aria-hidden="true" />
        <input aria-label="البحث في المنصة" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={assignmentsEnabled ? 'ابحث في المقررات والواجبات...' : 'ابحث في المقررات...'} />
        {query ? <div className="search-results">{results.length ? results.map((item) => <button type="button" key={`${item.kind}-${item.id}`} onClick={() => { setQuery(''); if (item.kind === 'course') onNavigate('courses'); else onOpenAssignment(item); }}><strong>{item.title}</strong><small>{item.kind === 'course' ? item.code : item.courseTitle}</small></button>) : <span>لا توجد نتائج في بياناتك.</span>}</div> : null}
      </label>
      <div className="topbar__actions">
        <button className="icon-button notification-button" aria-label="الإشعارات" title="لا توجد إشعارات" disabled><Bell size={20} /></button>
        <button className="profile" type="button" onClick={() => onNavigate('settings')} aria-label="فتح إعدادات الحساب">
          <span className="avatar">{user.displayName[0]}</span>
          <span><strong>{user.displayName}</strong><small>{roleNames[role]}</small></span>
        </button>
        <button className="icon-button logout-button" onClick={onLogout} aria-label="تسجيل الخروج" title="تسجيل الخروج"><LogOut size={19} /></button>
      </div>
    </header>
  );
}
