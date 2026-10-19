import { ArrowRight, CheckCircle2, Clock3, Code2, EyeOff, Play, RotateCcw, Send, Trophy, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import Brand from '../components/Brand';
import { apiFetch } from '../lib/api';

export default function PracticeWorkspace({ summary, onBack }) {
  const [exercise, setExercise] = useState(null); const [code, setCode] = useState(summary.starterCode || ''); const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true); const [running, setRunning] = useState(''); const [error, setError] = useState('');
  const load = async () => { setLoading(true); try { const data = await apiFetch(`/practice/${summary.id}`); setExercise(data.exercise); setCode((current) => current || data.exercise.starterCode || ''); } catch (caught) { setError(caught.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [summary.id]);
  const execute = async (kind) => { setRunning(kind); setError(''); try { const data = await apiFetch(`/practice/${summary.id}/${kind}`, { method: 'POST', body: JSON.stringify({ sourceCode: code }) }); setResult(data); if (kind === 'submit') await load(); } catch (caught) { setError(caught.message); } finally { setRunning(''); } };
  if (loading) return <div className="app-loading">جارٍ تجهيز بيئة التدريب...</div>;
  if (!exercise) return <div className="app-loading"><p>{error || 'تعذر فتح التدريب.'}</p><button className="button button--outline" onClick={onBack}>عودة</button></div>;
  const publicTests = exercise.tests.filter((test) => !test.isHidden);
  return <div className="practice-workspace" dir="rtl">
    <header className="practice-workspace__header"><Brand compact /><div><small>{exercise.courseCode}</small><h1>{exercise.title}</h1></div><div className="practice-workspace__points"><Trophy /> {exercise.points} نقطة</div><button className="button button--outline" onClick={onBack}><ArrowRight /> عودة</button></header>
    <main className="practice-workspace__grid">
      <aside className="practice-problem"><div className="practice-problem__badge"><Code2 /> Python 3.12</div><h2>نص المسألة</h2><p className="practice-description">{exercise.description}</p>
        <section><h3>طريقة الحل</h3><p>{exercise.executionMode === 'stdin' ? 'اقرأ القيم من الإدخال القياسي واطبع النتيجة المطلوبة فقط.' : <>عرّف دالة باسم <code dir="ltr">{exercise.functionName}</code> وأعد قيمة قابلة للتحويل إلى JSON.</>}</p></section>
        <section><h3>أمثلة عامة</h3>{publicTests.map((test, index) => <article className="practice-example" key={test.id}><strong>مثال {index + 1}</strong><label>المدخل</label><pre dir="ltr">{exercise.executionMode === 'stdin' ? test.inputPayload.stdin || '—' : JSON.stringify(test.inputPayload.arguments)}</pre><label>المخرج</label><pre dir="ltr">{exercise.executionMode === 'stdin' ? test.expectedPayload.stdout || '—' : JSON.stringify(test.expectedPayload.return)}</pre></article>)}</section>
      </aside>
      <section className="practice-code"><header><div><Code2 /><strong>الحل.py</strong></div><button onClick={() => setCode(exercise.starterCode || '')}><RotateCcw /> استعادة البداية</button></header><textarea dir="ltr" value={code} onChange={(event) => setCode(event.target.value)} spellCheck="false" aria-label="محرر شفرة Python" />
        <footer><span>التشغيل يستخدم الاختبارات العامة فقط. التسليم يستخدم جميع الاختبارات.</span><div><button className="button button--outline" disabled={Boolean(running)} onClick={() => execute('run')}><Play /> {running === 'run' ? 'جارٍ التشغيل...' : 'تشغيل'}</button><button className="button button--primary" disabled={Boolean(running)} onClick={() => execute('submit')}><Send /> {running === 'submit' ? 'جارٍ التقييم...' : 'تسليم الحل'}</button></div></footer>
      </section>
      <aside className="practice-results"><h2>نتيجة الاختبارات</h2>{error ? <div className="auth-error">{error}</div> : null}{!result ? <div className="practice-results__empty"><Play /><p>شغّل الحل لرؤية نتائج الحالات العامة، أو سلّمه للتقييم الكامل.</p></div> : <>
        <div className={`practice-result-banner ${result.result.passed ? 'is-passed' : 'is-failed'}`}>{result.result.passed ? <CheckCircle2 /> : <XCircle />}<div><strong>{result.result.passed ? 'اجتاز الحل جميع الاختبارات' : 'ما زال الحل بحاجة إلى تعديل'}</strong><span>{result.official ? 'تسليم رسمي' : 'تشغيل تجريبي'} · {result.result.runtimeMs}ms</span></div></div>
        {result.attempt?.pointsAwarded ? <div className="practice-award"><Trophy /><strong>+{result.attempt.pointsAwarded} نقطة</strong><span>حصلت عليها لأول إتمام</span></div> : null}
        <div className="practice-result-list">{result.result.results.map((test) => <article key={test.number}><span className={test.passed ? 'passed' : 'failed'}>{test.passed ? <CheckCircle2 /> : <XCircle />}</span><div><strong>{test.hidden ? <><EyeOff /> اختبار مخفي {test.number}</> : `الاختبار ${test.number}`}</strong><small><Clock3 /> {test.runtimeMs}ms</small>{test.errorMessage ? <p>{test.errorMessage}</p> : null}{!test.hidden && test.actualOutput != null ? <pre dir="ltr">{test.actualOutput || '(لا توجد مخرجات)'}</pre> : null}</div></article>)}</div>
      </>}
        {exercise.attempts.length ? <section className="practice-attempts"><h3>آخر المحاولات</h3>{exercise.attempts.slice(0, 6).map((attempt) => <div key={attempt.id}><span>المحاولة {attempt.attemptNumber}</span><strong className={attempt.status === 'passed' ? 'passed' : ''}>{attempt.status === 'passed' ? 'مكتملة' : attempt.status === 'failed' ? 'غير مكتملة' : 'خطأ'}</strong><small>{attempt.passedTests}/{attempt.totalTests}</small></div>)}</section> : null}
      </aside>
    </main>
  </div>;
}
