import { Mail, Phone, ShieldCheck, UserRound } from 'lucide-react';
import PasswordChangeForm from '../auth/PasswordChangeForm';
import { PageHeading } from '../components/Ui';

const roleNames = { student: 'طالب', teacher: 'أستاذ', admin: 'مدير النظام' };

export default function SettingsPage({ user, role }) {
  return <div className="stack-lg settings-page">
    <PageHeading title="إعدادات الحساب" description="إدارة بيانات حسابك وحماية الوصول إلى المنصة." />
    <div className="settings-layout">
      <aside className="panel account-card">
        <span className="account-card__avatar">{user.displayName[0]}</span>
        <div><h2>{user.displayName}</h2><span className="status status--progress">{roleNames[role]}</span></div>
        <dl>
          <div><dt><Mail aria-hidden="true" />البريد الإلكتروني</dt><dd dir="ltr">{user.email}</dd></div>
          <div><dt><Phone aria-hidden="true" />رقم الجوال</dt><dd dir="ltr">{user.phone || 'غير مضاف'}</dd></div>
          <div><dt><UserRound aria-hidden="true" />نوع الحساب</dt><dd>{roleNames[role]}</dd></div>
        </dl>
      </aside>
      <section className="panel security-card">
        <header><span><ShieldCheck aria-hidden="true" /></span><div><h2>تغيير كلمة المرور</h2><p>استخدم كلمة مرور خاصة بهذا الحساب ولا تشاركها مع أي شخص.</p></div></header>
        <PasswordChangeForm />
        <p className="security-session-note">بعد نجاح التغيير سيتم إنهاء جميع جلسات حسابك، وستحتاج إلى تسجيل الدخول بكلمة المرور الجديدة.</p>
      </section>
    </div>
  </div>;
}
