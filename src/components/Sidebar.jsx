import { Activity, BarChart3, BookOpen, BrainCircuit, CalendarRange, ClipboardCheck, FileCode2, GraduationCap, Home, Network, Settings, Users, X } from 'lucide-react';
import Brand from './Brand';
import { pagePath } from '../lib/navigation';

const menus = {
  student: [
    ['dashboard', 'الرئيسية', Home], ['courses', 'مقرراتي', BookOpen], ['practices', 'التدريبات', BrainCircuit], ['assignments', 'الواجبات', FileCode2], ['grades', 'الدرجات', BarChart3], ['settings', 'إعدادات الحساب', Settings],
  ],
  teacher: [
    ['dashboard', 'لوحة المقرر', Home], ['courses', 'مقرراتي', BookOpen], ['practices', 'إدارة التدريبات', BrainCircuit], ['assignments', 'إدارة الواجبات', ClipboardCheck], ['student-activity', 'نشاط الطلاب', Activity], ['students', 'الطلاب', Users], ['settings', 'إعدادات الحساب', Settings],
  ],
  admin: [
    ['dashboard', 'نظرة عامة', Home], ['courses', 'دليل المقررات', BookOpen], ['academic-delivery', 'التشغيل الأكاديمي', CalendarRange], ['practices', 'التدريبات', BrainCircuit], ['assignments', 'الواجبات', ClipboardCheck], ['student-activity', 'نشاط الطلاب', Activity], ['academic-structure', 'الهيكل الأكاديمي', Network], ['students', 'المستخدمون', Users], ['settings', 'إعدادات الحساب', Settings],
  ],
};

export default function Sidebar({ role, page, open, onNavigate, onClose }) {
  return (
    <>
      <button className={`sidebar-backdrop ${open ? 'is-open' : ''}`} onClick={onClose} aria-label="إغلاق القائمة" />
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar__mobile-brand"><Brand compact /><button className="icon-button" onClick={onClose}><X size={19} /></button></div>
        <nav aria-label="التنقل الرئيسي">
          {menus[role].map(([key, label, Icon]) => (
            <a
              key={key}
              href={pagePath(key)}
              className={page === key ? 'active' : ''}
              aria-current={page === key ? 'page' : undefined}
              onClick={(event) => {
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onNavigate(key);
                onClose();
              }}
            >
              <Icon size={20} strokeWidth={1.9} /><span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar__support">
          <GraduationCap size={25} />
          <div><strong>هل تحتاج مساعدة؟</strong><small>تواصل مع فريق الدعم الأكاديمي</small></div>
          <button>مركز المساعدة</button>
        </div>
      </aside>
    </>
  );
}
