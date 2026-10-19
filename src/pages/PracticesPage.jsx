import { Archive, CheckCircle2, CircleGauge, Code2, Edit3, Eye, Play, Plus, Send, Sparkles, Trophy, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import PracticeEditorModal from '../components/PracticeEditorModal';
import PracticeAttemptsModal from '../components/PracticeAttemptsModal';
import Select from '../components/Select';
import { DataState, EmptyState, PageHeading, PrimaryButton } from '../components/Ui';
import { apiFetch } from '../lib/api';
import { offeringLabel } from '../lib/courseLabels';

const difficultyLabels = { easy: 'سهل', medium: 'متوسط', hard: 'متقدم' };
const studentStatusFilters = [
  { value: 'available', label: 'متاحة للحل' },
  { value: 'completed', label: 'مكتملة' },
  { value: 'all', label: 'الكل' },
];

export default function PracticesPage({ role, courses, onOpenWorkspace }) {
  const manager = role === 'admin' || role === 'teacher';
  const [items, setItems] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [stats, setStats] = useState({ totalPoints: 0, completedCount: 0, attemptCount: 0 });
  const [courseFilter, setCourseFilter] = useState('all'); const [statusFilter, setStatusFilter] = useState('available');
  const [editor, setEditor] = useState(null); const [busyId, setBusyId] = useState('');
  const [attemptsExercise, setAttemptsExercise] = useState(null);
  const load = async () => { setLoading(true); setError(''); try { const data = await apiFetch('/practice'); setItems(data.exercises); if (data.stats) setStats(data.stats); } catch (caught) { setError(caught.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const courseItems = useMemo(() => courseFilter === 'all' ? items : items.filter((item) => item.offeringId === courseFilter), [items, courseFilter]);
  const completionCounts = useMemo(() => {
    let completed = 0;
    for (const item of courseItems) if (item.completed) completed += 1;
    return { available: courseItems.length - completed, completed, all: courseItems.length };
  }, [courseItems]);
  const filtered = useMemo(() => {
    if (manager || statusFilter === 'all') return courseItems;
    return courseItems.filter((item) => statusFilter === 'completed' ? item.completed : !item.completed);
  }, [courseItems, manager, statusFilter]);
  const changeStatus = async (item, status) => { setBusyId(item.id); setError(''); try { await apiFetch(`/practice/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load(); } catch (caught) { setError(caught.message); } finally { setBusyId(''); } };
  const openEditor = async (item) => {
    setBusyId(item.id); setError('');
    try { const data = await apiFetch(`/practice/${item.id}`); setEditor({ mode: 'edit', exercise: data.exercise }); }
    catch (caught) { setError(caught.message); }
    finally { setBusyId(''); }
  };

  return <div className="stack-lg">
    <PageHeading title="التدريبات" description={manager ? 'أنشئ تدريبات المقررات، وراجع إعداداتها ومعايير تقييمها، ثم انشرها للطلاب.' : 'تدرّب بلا مواعيد نهائية، وراكم النقاط عند إتمام كل تدريب لأول مرة.'} action={manager ? <PrimaryButton icon={false} onClick={() => setEditor({ mode: 'create' })}><Plus size={18} /> تدريب جديد</PrimaryButton> : null} />
    {!manager ? <section className="practice-summary"><div><Sparkles /><span>نقاط التدريبات</span><strong>{stats.totalPoints}</strong></div><div><CheckCircle2 /><span>مكتملة</span><strong>{stats.completedCount}</strong></div><div><CircleGauge /><span>المحاولات</span><strong>{stats.attemptCount}</strong></div></section> : null}
    <div className={`practice-toolbar ${manager ? '' : 'practice-toolbar--student'}`}>
      <Select value={courseFilter} onValueChange={setCourseFilter} options={[{ value: 'all', label: 'جميع الشُّعب' }, ...courses.map((course) => ({ value: course.offeringId, label: offeringLabel(course) }))]} ariaLabel="تصفية حسب الشعبة" />
      {!manager ? <div className="practice-status-tabs" role="tablist" aria-label="تصفية التدريبات حسب حالة الإنجاز">{studentStatusFilters.map((filter) => <button type="button" role="tab" aria-selected={statusFilter === filter.value} className={statusFilter === filter.value ? 'is-active' : ''} onClick={() => setStatusFilter(filter.value)} key={filter.value}><span>{filter.label}</span><b>{completionCounts[filter.value]}</b></button>)}</div> : null}
      <span aria-live="polite">{filtered.length} تدريب</span>
    </div>
    <DataState loading={loading} error={error} empty={false}>
      {!filtered.length ? <PracticeEmptyState manager={manager} statusFilter={statusFilter} courseItemCount={courseItems.length} completedCount={completionCounts.completed} onShowCompleted={() => setStatusFilter('completed')} onShowAvailable={() => setStatusFilter('available')} /> :
      <div className="practice-grid">{filtered.map((item) => <article className={`practice-card ${item.completed ? 'is-complete' : ''}`} key={item.id}>
        <div className="practice-card__top"><span className={`practice-difficulty practice-difficulty--${item.difficulty}`}>{difficultyLabels[item.difficulty]}</span><span className={`status status--${item.completed || item.status === 'published' ? 'success' : 'muted'}`}>{!manager ? item.completed ? 'مكتمل' : 'متاح' : item.status === 'published' ? 'منشور' : item.status === 'draft' ? 'مسودة' : 'مؤرشف'}</span></div>
        <div className="practice-card__icon"><Code2 /></div><small>{item.courseCode} · {item.courseTitle} · {item.termName} · الشعبة {item.sectionCode}</small><h2>{item.title}</h2><p>{item.description}</p>
        <div className="practice-card__meta"><span><Trophy /> {item.points} نقطة</span><span><Eye /> {item.testCount} اختبارات</span>{manager ? <span><Send /> {item.attemptCount} محاولة</span> : <span><CircleGauge /> {item.myAttemptCount} محاولة</span>}</div>
        <footer>{manager ? <>
          <button onClick={() => setAttemptsExercise(item)}><UsersRound /> محاولات الطلاب</button>
          {item.status !== 'archived' ? <button disabled={busyId === item.id} onClick={() => openEditor(item)}><Edit3 /> تعديل</button> : null}
          {item.status !== 'published' ? <button className="primary-action" disabled={busyId === item.id} onClick={() => changeStatus(item, 'published')}><Play /> {busyId === item.id ? 'جارٍ التحقق...' : 'تحقق وانشر'}</button> : <button className="danger-action" disabled={busyId === item.id} onClick={() => changeStatus(item, 'archived')}><Archive /> أرشفة</button>}
        </> : <button className="primary-action" onClick={() => onOpenWorkspace(item)}>{item.completed ? <CheckCircle2 /> : <Play />}{item.completed ? 'مراجعة الحل' : 'ابدأ التدريب'}</button>}</footer>
      </article>)}</div>}
    </DataState>
    {editor ? <PracticeEditorModal courses={courses} exercise={editor.exercise} onClose={() => setEditor(null)} onSaved={load} /> : null}
    {attemptsExercise ? <PracticeAttemptsModal exercise={attemptsExercise} onClose={() => setAttemptsExercise(null)} /> : null}
  </div>;
}

function PracticeEmptyState({ manager, statusFilter, courseItemCount, completedCount, onShowCompleted, onShowAvailable }) {
  if (manager || !courseItemCount) return <EmptyState title="لا توجد تدريبات بعد" text="ستظهر التدريبات هنا فور إضافتها إلى المقرر." />;
  if (statusFilter === 'available' && completedCount) return <EmptyState title="أكملت جميع التدريبات المتاحة" text="عمل رائع! يمكنك العودة إلى حلولك السابقة ومراجعتها في أي وقت." action={<button type="button" className="button button--outline" onClick={onShowCompleted}><CheckCircle2 /> مراجعة التدريبات المكتملة</button>} />;
  if (statusFilter === 'completed') return <EmptyState title="لا توجد تدريبات مكتملة بعد" text="عندما تجتاز تدريبًا سيظهر هنا لتتمكن من مراجعته لاحقًا." action={<button type="button" className="button button--outline" onClick={onShowAvailable}><Play /> استعراض التدريبات المتاحة</button>} />;
  return <EmptyState title="لا توجد تدريبات في هذا المقرر" text="ستظهر التدريبات هنا فور نشرها لك." />;
}
