import { ArrowRight, CheckCircle2, Clock3, Code2, EyeOff, Search, Trophy, UserRound, UsersRound, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';

const statusLabels = { passed: 'مكتملة', failed: 'غير مكتملة', error: 'خطأ في التنفيذ', running: 'قيد التنفيذ' };
const dateFormatter = new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeStyle: 'short' });

export default function PracticeAttemptsModal({ exercise, onClose }) {
  const [roster, setRoster] = useState(null); const [selectedStudent, setSelectedStudent] = useState(null);
  const [attempts, setAttempts] = useState([]); const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(''); const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    apiFetch(`/practice/${exercise.id}/students`).then((data) => { if (active) setRoster(data); }).catch((caught) => { if (active) setError(caught.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [exercise.id]);

  const students = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ar');
    return (roster?.students ?? []).filter((student) => !query || student.displayName.toLocaleLowerCase('ar').includes(query));
  }, [roster, search]);

  const openAttempt = async (attemptId) => {
    setDetailLoading(true); setError('');
    try { const data = await apiFetch(`/practice/${exercise.id}/attempts/${attemptId}`); setSelectedAttempt(data.attempt); }
    catch (caught) { setError(caught.message); }
    finally { setDetailLoading(false); }
  };

  const openStudent = async (student) => {
    setSelectedStudent(student); setSelectedAttempt(null); setAttempts([]); setDetailLoading(true); setError('');
    try {
      const data = await apiFetch(`/practice/${exercise.id}/students/${student.studentId}/attempts`);
      setAttempts(data.attempts);
      if (data.attempts[0]) await openAttempt(data.attempts[0].id);
    } catch (caught) { setError(caught.message); setDetailLoading(false); }
    finally { setDetailLoading(false); }
  };

  const backToRoster = () => { setSelectedStudent(null); setSelectedAttempt(null); setAttempts([]); setError(''); };

  return <div className="modal-backdrop" role="presentation">
    <section className="modal modal--practice-attempts" role="dialog" aria-modal="true" aria-labelledby="attempts-title">
      <header><div>{selectedStudent ? <button className="attempts-back" onClick={backToRoster}><ArrowRight /> جميع الطلاب</button> : null}<h2 id="attempts-title">{selectedStudent ? selectedStudent.displayName : 'محاولات الطلاب'}</h2><small>{exercise.courseCode} · {exercise.title}</small></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X /></button></header>
      {error ? <div className="attempts-error auth-error" role="alert">{error}</div> : null}
      {loading ? <div className="data-state attempts-loading">جارٍ تحميل محاولات الطلاب...</div> : selectedStudent ? <AttemptExplorer attempts={attempts} selectedAttempt={selectedAttempt} loading={detailLoading} onOpen={openAttempt} /> : <Roster roster={roster} students={students} search={search} onSearch={setSearch} onOpen={openStudent} />}
      <footer><span><EyeOff /> تظهر الشفرة بوضع القراءة فقط، ويُسجل فتح المحاولة في سجل التدقيق.</span><button className="button button--outline" onClick={onClose}>إغلاق</button></footer>
    </section>
  </div>;
}

function Roster({ roster, students, search, onSearch, onOpen }) {
  const summary = roster?.summary ?? { studentCount: 0, attemptedCount: 0, completedCount: 0, attemptCount: 0 };
  return <div className="attempts-roster">
    <section className="attempts-summary">
      <div><UsersRound /><span>الطلاب</span><strong>{summary.studentCount}</strong></div>
      <div><Code2 /><span>بدأوا الحل</span><strong>{summary.attemptedCount}</strong></div>
      <div><CheckCircle2 /><span>أكملوا التدريب</span><strong>{summary.completedCount}</strong></div>
      <div><Clock3 /><span>إجمالي المحاولات</span><strong>{summary.attemptCount}</strong></div>
    </section>
    <label className="attempts-search"><Search /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="ابحث باسم الطالب" /></label>
    <div className="attempts-table-shell"><table><thead><tr><th>الطالب</th><th>الحالة</th><th>المحاولات</th><th>أفضل نتيجة</th><th>آخر محاولة</th><th></th></tr></thead>
      <tbody>{students.map((student) => <tr key={student.studentId}>
        <td data-label="الطالب"><span className="attempt-student"><i>{student.displayName.trim().charAt(0)}</i><strong>{student.displayName}</strong></span></td>
        <td data-label="الحالة">{student.completedAt ? <span className="attempt-status is-passed"><CheckCircle2 /> مكتمل</span> : student.attemptCount ? <span className="attempt-status is-progress"><Clock3 /> قيد المحاولة</span> : <span className="attempt-status is-muted">لم يبدأ</span>}</td>
        <td data-label="المحاولات">{student.attemptCount}</td><td data-label="أفضل نتيجة">{student.totalTests ? `${student.bestPassedTests} / ${student.totalTests}` : '—'}</td><td data-label="آخر محاولة">{student.lastAttemptAt ? dateFormatter.format(new Date(student.lastAttemptAt)) : '—'}</td>
        <td data-label="الإجراء"><button className="table-action" disabled={!student.attemptCount} onClick={() => onOpen(student)}>{student.attemptCount ? 'عرض الحلول' : 'لا توجد محاولات'}</button></td>
      </tr>)}</tbody></table>{!students.length ? <div className="attempts-empty">لا يوجد طلاب مطابقون للبحث.</div> : null}</div>
  </div>;
}

export function AttemptExplorer({ attempts, selectedAttempt, loading, onOpen }) {
  return <div className="attempt-explorer">
    <aside className="attempt-list"><h3>المحاولات</h3>{attempts.length ? attempts.map((attempt) => <button key={attempt.id} className={selectedAttempt?.id === attempt.id ? 'is-active' : ''} onClick={() => onOpen(attempt.id)}>
      <span><strong>المحاولة {attempt.attemptNumber}</strong><small>{dateFormatter.format(new Date(attempt.submittedAt))}</small></span><em className={attempt.status === 'passed' ? 'is-passed' : ''}>{statusLabels[attempt.status] ?? attempt.status}</em><small>{attempt.passedTests}/{attempt.totalTests}</small>
    </button>) : <div className="attempts-empty">لم يرسل الطالب أي محاولة.</div>}</aside>
    <section className="attempt-detail">{loading ? <div className="data-state">جارٍ تحميل تفاصيل المحاولة...</div> : selectedAttempt ? <>
      <div className="attempt-detail__summary"><div><UserRound /><span>الطالب</span><strong>{selectedAttempt.studentName}</strong></div><div><CheckCircle2 /><span>النتيجة</span><strong>{selectedAttempt.passedTests} / {selectedAttempt.totalTests}</strong></div><div><Clock3 /><span>الزمن</span><strong>{selectedAttempt.runtimeMs ?? 0}ms</strong></div><div><Trophy /><span>الحالة</span><strong>{statusLabels[selectedAttempt.status] ?? selectedAttempt.status}</strong></div></div>
      <section className="attempt-code"><header><div><Code2 /><strong>حل الطالب · Python {selectedAttempt.pythonVersion}</strong></div><span>قراءة فقط</span></header><pre dir="ltr"><code>{selectedAttempt.sourceCode}</code></pre></section>
      {selectedAttempt.errorMessage ? <div className="attempt-runtime-error"><XCircle /> <pre>{selectedAttempt.errorMessage}</pre></div> : null}
      <section className="attempt-test-results"><h3>نتائج الاختبارات</h3><div>{selectedAttempt.results.map((result) => <article key={result.number}><span className={result.passed ? 'is-passed' : 'is-failed'}>{result.passed ? <CheckCircle2 /> : <XCircle />}</span><p><strong>{result.hidden ? `اختبار مخفي ${result.number}` : `اختبار عام ${result.number}`}</strong><small>{result.runtimeMs}ms</small>{result.errorMessage ? <em>{result.errorMessage}</em> : null}</p></article>)}</div></section>
    </> : <div className="data-state">اختر محاولة لعرض الحل.</div>}</section>
  </div>;
}
