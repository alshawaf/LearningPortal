import { CheckCircle2, Clock3, Eye, EyeOff, FileCheck2, LockKeyhole, ShieldCheck, UserRoundPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import Brand from '../components/Brand';
import { AcademicLevelFields } from '../components/CreateModal';
import { apiFetch } from '../lib/api';

const statusContent = {
  pending: { icon: Clock3, title: 'طلبك قيد المراجعة', description: 'ستراجع إدارة المنصة بياناتك الأكاديمية قبل تفعيل الحساب.', tone: 'pending' },
  changes_requested: { icon: FileCheck2, title: 'مطلوب مراجعة بعض البيانات', description: 'راجع ملاحظة الإدارة أدناه وتواصل معها لتحديث البيانات المطلوبة.', tone: 'changes' },
  approved: { icon: CheckCircle2, title: 'تمت الموافقة على حسابك', description: 'أصبح حسابك فعالاً ويمكنك تسجيل الدخول بالبريد أو رقم الجوال وكلمة المرور التي اخترتها.', tone: 'approved' },
  rejected: { icon: ShieldCheck, title: 'تعذر اعتماد الطلب', description: 'يمكنك مراجعة ملاحظة الإدارة والتواصل معها لمزيد من المعلومات.', tone: 'rejected' },
};

function PublicShell({ children, compact = false, minimal = false }) {
  return <main className={`login-page public-auth-page${compact ? ' public-auth-page--compact' : ''}`}>
    <section className={`login-brand-panel registration-brand-panel${minimal ? ' login-brand-panel--minimal registration-brand-panel--minimal' : ''}`}>
      {minimal ? <>
        <Brand />
        <div className="registration-review-window">سيتم مُراجعة طلب الالتحاق من قِبل الإدارة خلال الأربع ساعات القادمة</div>
      </> : <>
        <Brand />
        <div><span className="registration-eyebrow"><ShieldCheck /> تسجيل موثوق</span><h1>ابدأ مسارك الأكاديمي في بيئة تعليمية موثوقة.</h1><p>يُراجع طلبك من إدارة المنصة قبل تفعيل الحساب وربطه بمقررات مستواك.</p></div>
        <small>لن تتمكن من الوصول إلى المقررات قبل موافقة الإدارة، ولن نعرض كلمة مرورك لأي مستخدم أو مسؤول.</small>
      </>}
    </section>
    <section className="login-form-panel registration-form-panel">{children}</section>
  </main>;
}

export function StudentRegistrationPage({ onNavigate }) {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiFetch('/registration/options').then((result) => { if (active) setDepartments(result.departments); })
      .catch((caught) => { if (active) setError(caught.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const submit = async (event) => {
    event.preventDefault(); setSubmitting(true); setError('');
    const values = new FormData(event.currentTarget);
    try {
      await apiFetch('/registration', {
        method: 'POST', body: JSON.stringify({
          displayName: values.get('displayName'), email: values.get('email'), phone: values.get('phone'),
          studentNumber: values.get('studentNumber') || '', academicLevelId: values.get('academicLevelId'),
          password: values.get('password'), confirmPassword: values.get('confirmPassword'),
        }),
      });
      onNavigate('status');
    } catch (caught) { setError(caught.message || 'تعذر إرسال طلب التسجيل.'); }
    finally { setSubmitting(false); }
  };

  return <PublicShell minimal><form className="registration-form" onSubmit={submit}>
    <header><span className="registration-step">طلب تسجيل طالب</span><h2>إنشاء حساب جديد</h2><p>أدخل بياناتك كما تظهر في سجلك الأكاديمي.</p></header>
    {error ? <div className="auth-error" role="alert">{error}</div> : null}
    {loading ? <div className="registration-loading">جارٍ تحميل الهيكل الأكاديمي...</div> : <>
      <div className="registration-fields">
        <label>الاسم الكامل<input name="displayName" required minLength="2" maxLength="120" autoComplete="name" placeholder="الاسم الثلاثي أو الرباعي" /></label>
        <label><span className="field-label">الرقم الجامعي <small>(اختياري)</small></span><input name="studentNumber" maxLength="32" dir="ltr" autoComplete="off" placeholder="مثال: 202600123" /></label>
        <label>البريد الإلكتروني<input name="email" type="email" required autoComplete="email" placeholder="name@example.com" dir="ltr" /></label>
        <label>رقم الجوال<input name="phone" type="tel" required inputMode="tel" autoComplete="tel" placeholder="+967777123456" dir="ltr" /></label>
        <AcademicLevelFields departments={departments} />
        <label>كلمة المرور<div className="registration-password"><input name="password" type={showPassword ? 'text' : 'password'} required minLength="8" maxLength="40" autoComplete="new-password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
        <label>تأكيد كلمة المرور<input name="confirmPassword" type={showPassword ? 'text' : 'password'} required minLength="8" maxLength="40" autoComplete="new-password" /></label>
      </div>
      <p className="registration-password-hint"><LockKeyhole /> من 8 إلى 40 حرفاً، وتحتوي على حروف وأرقام. تُحفظ بصورة مشفرة.</p>
      <label className="registration-consent"><input type="checkbox" required /> <span>أقر بصحة البيانات وأوافق على استخدامها لمراجعة الطلب وربط الحساب بالمسار الأكاديمي وفق <button type="button" className="inline-link" onClick={() => onNavigate('privacy')}>سياسة الخصوصية</button>.</span></label>
      <button className="button button--primary registration-submit" disabled={submitting || !departments.length}><UserRoundPlus /> {submitting ? 'جارٍ إرسال الطلب...' : 'إرسال طلب التسجيل'}</button>
    </>}
    <button type="button" className="auth-text-button" onClick={() => onNavigate('login')}>لديك حساب؟ تسجيل الدخول</button>
  </form></PublicShell>;
}

export function RegistrationStatusPage({ onNavigate }) {
  const [registration, setRegistration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiFetch('/registration/status').then((result) => { if (active) setRegistration(result.registration); })
      .catch((caught) => { if (active) setError(caught.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const content = registration ? statusContent[registration.status] ?? statusContent.pending : statusContent.pending;
  const Icon = content.icon;
  return <PublicShell compact><div className="registration-status-card">
    {loading ? <div className="registration-loading">جارٍ تحميل حالة الطلب...</div> : error ? <><div className="auth-error" role="alert">{error}</div><button className="button button--primary" onClick={() => onNavigate('register')}>تقديم طلب تسجيل</button></> : <>
      <span className={`registration-status-icon registration-status-icon--${content.tone}`}><Icon /></span>
      <p className="registration-step">متابعة طلب التسجيل</p><h2>{content.title}</h2><p>{content.description}</p>
      <dl className="registration-status-details">
        <div><dt>الطالب</dt><dd>{registration.displayName}</dd></div>
        <div><dt>المسار الأكاديمي</dt><dd>{registration.departmentName} · {registration.specializationName} · {registration.levelName}</dd></div>
        <div><dt>تاريخ الطلب</dt><dd>{new Intl.DateTimeFormat('ar-YE', { dateStyle: 'long' }).format(new Date(registration.createdAt))}</dd></div>
        {registration.decisionReason ? <div className="registration-decision-note"><dt>ملاحظة الإدارة</dt><dd>{registration.decisionReason}</dd></div> : null}
      </dl>
      <div className="registration-status-actions">{registration.status === 'approved' ? <button className="button button--primary" onClick={() => onNavigate('login')}>الانتقال إلى تسجيل الدخول</button> : <button className="button button--outline" onClick={() => window.location.reload()}>تحديث حالة الطلب</button>}<button className="auth-text-button" onClick={() => onNavigate('login')}>العودة إلى تسجيل الدخول</button></div>
    </>}
  </div></PublicShell>;
}
