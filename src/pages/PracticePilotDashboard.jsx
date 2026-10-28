import { ArrowLeft, BookOpen, CheckCircle2, CircleGauge, Play, Sparkles, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { DataState, EmptyState, PageHeading } from '../components/Ui';

export default function PracticePilotDashboard({ role, user, courses, onNavigate }) {
  const manager = role === 'teacher';
  const [data, setData] = useState({ exercises: [], stats: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiFetch('/practice').then((result) => { if (active) setData(result); })
      .catch((caught) => { if (active) setError(caught.message || 'تعذر تحميل ملخص التدريبات.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const metrics = useMemo(() => manager ? {
    primary: data.exercises.filter((item) => item.status === 'published').length,
    secondary: data.exercises.reduce((sum, item) => sum + item.attemptCount, 0),
    tertiary: courses.length,
  } : {
    primary: data.stats?.totalPoints ?? 0,
    secondary: data.stats?.completedCount ?? 0,
    tertiary: data.exercises.filter((item) => !item.completed).length,
  }, [courses.length, data, manager]);

  const highlighted = manager ? data.exercises.slice(0, 4) : data.exercises.filter((item) => !item.completed).slice(0, 4);
  return <div className="stack-lg">
    <section className="welcome-band"><div><h1>مرحباً، {user.displayName}</h1><p>{manager ? 'تابع تدريبات مقرراتك ومحاولات الطلاب من مكان واحد.' : 'واصل التدريب وراكم نقاط التقدم في مقرراتك.'}</p></div><div className="welcome-band__art" aria-hidden="true"><BookOpen /><Sparkles /></div></section>
    <DataState loading={loading} error={error} empty={false}>
      <section className="practice-summary" aria-label="ملخص التدريبات">
        <div><Trophy /><span>{manager ? 'تدريبات منشورة' : 'نقاط التدريبات'}</span><strong>{metrics.primary}</strong></div>
        <div><CheckCircle2 /><span>{manager ? 'محاولات الطلاب' : 'تدريبات مكتملة'}</span><strong>{metrics.secondary}</strong></div>
        <div><CircleGauge /><span>{manager ? 'المقررات المسندة' : 'متاحة الآن'}</span><strong>{metrics.tertiary}</strong></div>
      </section>
      <section><PageHeading title={manager ? 'أحدث التدريبات' : 'ابدأ من هنا'} action={<button className="text-button" onClick={() => onNavigate('practices')}>عرض جميع التدريبات <ArrowLeft size={16} /></button>} />
        {highlighted.length ? <div className="pilot-practice-list">{highlighted.map((item) => <button type="button" key={item.id} onClick={() => onNavigate('practices')}><span><Play /></span><p><strong>{item.title}</strong><small>{item.courseCode} · {item.courseTitle} · {item.points} نقطة</small></p><ArrowLeft /></button>)}</div> : <EmptyState title={manager ? 'لا توجد تدريبات بعد' : 'أكملت جميع التدريبات المتاحة'} text={manager ? 'أنشئ أول تدريب من صفحة إدارة التدريبات.' : 'يمكنك مراجعة حلولك السابقة من صفحة التدريبات المكتملة.'} />}
      </section>
    </DataState>
  </div>;
}
