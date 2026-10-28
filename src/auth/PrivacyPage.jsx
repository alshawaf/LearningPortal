import { Database, FileCode2, LockKeyhole, ShieldCheck } from 'lucide-react';
import Brand from '../components/Brand';
import { DATA_RETENTION_DAYS, SUPPORT_EMAIL } from '../config/features';

export default function PrivacyPage({ onBack }) {
  return <main className="privacy-page" dir="rtl"><header><Brand /><button type="button" className="button button--outline" onClick={onBack}>العودة إلى تسجيل الدخول</button></header><article>
    <span className="privacy-eyebrow"><ShieldCheck /> سياسة الخصوصية للنسخة التجريبية</span>
    <h1>كيف تستخدم البوابة التعليمية بياناتك؟</h1>
    <p>تستخدم المنصة البيانات اللازمة لإنشاء الحساب، وربطه بالشعبة والمقرر، وتشغيل التدريبات، وقياس التقدم الأكاديمي فقط.</p>
    <section><Database /><div><h2>البيانات المحفوظة</h2><p>الاسم والبريد والجوال والرقم الجامعي والمسار الأكاديمي، إضافة إلى جلسات الدخول ومحاولات التدريبات ونتائجها.</p></div></section>
    <section><FileCode2 /><div><h2>شفرة الحلول</h2><p>تُحفظ الشفرة التي يرسلها الطالب لأغراض المراجعة وقياس التقدم. يطلع عليها الطالب نفسه، وأستاذ المقرر، ومدير المنصة وفق الصلاحيات المسجلة.</p></div></section>
    <section><LockKeyhole /><div><h2>الحماية والاحتفاظ</h2><p>تُحفظ كلمات المرور بصورة مشفرة ولا يمكن للإدارة قراءتها. تُحتفظ ببيانات النسخة التجريبية مدة تصل إلى {DATA_RETENTION_DAYS} يومًا ما لم تتطلب السجلات الأكاديمية مدة أطول أو يُطلب حذفها وفق سياسة الكلية.</p></div></section>
    <h2>طلب التصحيح أو الحذف</h2><p>يمكنك طلب تصحيح بياناتك من إدارة المنصة. {SUPPORT_EMAIL ? <>للاستفسار تواصل عبر <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</> : 'ستُنشر وسيلة التواصل الرسمية قبل فتح التسجيل العام.'}</p>
    <small>آخر تحديث: أكتوبر 2026 — تنطبق هذه السياسة على الإطلاق التجريبي للتدريبات.</small>
  </article></main>;
}
