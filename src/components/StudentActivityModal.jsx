import { ArrowRight, BookOpen, CheckCircle2, CircleGauge, Clock3, EyeOff, Trophy, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { AttemptExplorer } from './PracticeAttemptsModal';
import { Progress } from './Ui';

const dateFormatter = new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeStyle: 'short' });
const exerciseStatusLabels = { completed: 'مكتمل', in_progress: 'قيد التقدم', not_started: 'لم يبدأ' };
const attemptStatusLabels = { passed: 'اجتاز', failed: 'لم يجتز', error: 'خطأ في التنفيذ', running: 'قيد التنفيذ' };

export default function StudentActivityModal({ student, offeringId, onClose }) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [selectedExercise, setSelectedExercise] = useState(null); const [attempts, setAttempts] = useState([]);
  const [selectedAttempt, setSelectedAttempt] = useState(null); const [attemptLoading, setAttemptLoading] = useState(false);
  const suffix = offeringId === 'all' ? '' : `?offeringId=${encodeURIComponent(offeringId)}`;

  useEffect(() => {
    let active = true;
    apiFetch(`/student-activity/${student.studentId}${suffix}`)
      .then((value) => { if (active) setData(value); })
      .catch((caught) => { if (active) setError(caught.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [student.studentId, suffix]);

  const openAttempt = async (attemptId, exercise = selectedExercise) => {
    setAttemptLoading(true); setError('');
    try {
      const response = await apiFetch(`/practice/${exercise.id}/attempts/${attemptId}`);
      setSelectedAttempt(response.attempt);
    } catch (caught) { setError(caught.message); }
    finally { setAttemptLoading(false); }
  };

  const openExercise = async (exercise) => {
    setSelectedExercise(exercise); setAttempts([]); setSelectedAttempt(null); setAttemptLoading(true); setError('');
    try {
      const response = await apiFetch(`/practice/${exercise.id}/students/${student.studentId}/attempts`);
      setAttempts(response.attempts);
      if (response.attempts[0]) await openAttempt(response.attempts[0].id, exercise);
    } catch (caught) { setError(caught.message); }
    finally { setAttemptLoading(false); }
  };

  const backToOverview = () => { setSelectedExercise(null); setAttempts([]); setSelectedAttempt(null); setError(''); };
  const profile = data?.student ?? student;

  return <div className="modal-backdrop" role="presentation">
    <section className="modal modal--student-activity" role="dialog" aria-modal="true" aria-labelledby="student-activity-title">
      <header><div>{selectedExercise ? <button className="attempts-back" onClick={backToOverview}><ArrowRight /> نشاط الطالب</button> : null}<h2 id="student-activity-title">{profile.displayName}</h2><small>{selectedExercise ? `${selectedExercise.courseCode} · ${selectedExercise.title}` : academicPath(profile)}</small></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X /></button></header>
      {error ? <div className="attempts-error auth-error" role="alert">{error}</div> : null}
      {loading ? <div className="data-state activity-modal-loading">جارٍ تحميل نشاط الطالب...</div> : selectedExercise ? <AttemptExplorer attempts={attempts} selectedAttempt={selectedAttempt} loading={attemptLoading} onOpen={(attemptId) => openAttempt(attemptId)} /> : data ? <ActivityOverview data={data} onOpenExercise={openExercise} /> : <div className="data-state activity-modal-loading">تعذر تحميل بيانات نشاط الطالب.</div>}
      <footer><span><EyeOff /> لا تظهر شفرة الطالب إلا عند فتح محاولة، ويُسجل ذلك في سجل التدقيق.</span><button className="button button--outline" onClick={onClose}>إغلاق</button></footer>
    </section>
  </div>;
}

function ActivityOverview({ data, onOpenExercise }) {
  const { summary, courses, exercises, recentAttempts } = data;
  return <div className="student-activity-detail">
    <section className="activity-detail-summary">
      <div><BookOpen /><span>التدريبات المكتملة</span><strong>{summary.completedCount} من {summary.exerciseCount}</strong></div>
      <div><CircleGauge /><span>نسبة الإنجاز</span><strong>{summary.completionRate}%</strong></div>
      <div><Clock3 /><span>المحاولات</span><strong>{summary.attemptCount}</strong></div>
      <div><Trophy /><span>النقاط</span><strong>{summary.points}</strong></div>
    </section>
    <section className="activity-course-progress"><h3>التقدم حسب الشعبة</h3><div>{courses.map((course) => <article key={course.id}><header><div><strong>{course.title}</strong><small>{course.code} · {course.termName} · الشعبة {course.sectionCode} · {course.completedCount} من {course.exerciseCount}</small></div><b>{course.completionRate}%</b></header><Progress value={course.completionRate} /></article>)}</div></section>
    <div className="activity-detail-columns">
      <section className="activity-exercises"><h3>التدريبات</h3><div className="activity-exercise-list">{exercises.map((exercise) => <article key={exercise.id}><div><strong>{exercise.title}</strong><small>{exercise.courseCode} · الشعبة {exercise.sectionCode} · {exercise.attemptCount} محاولة</small></div><span className={`activity-status activity-status--${exercise.status}`}>{exerciseStatusLabels[exercise.status]}</span><span>{exercise.totalTests ? `${exercise.bestPassedTests}/${exercise.totalTests}` : '—'}</span><button className="table-action" disabled={!exercise.attemptCount} onClick={() => onOpenExercise(exercise)}>{exercise.attemptCount ? 'عرض المحاولات' : 'لا توجد محاولات'}</button></article>)}</div></section>
      <section className="activity-timeline"><h3>آخر النشاطات</h3><div>{recentAttempts.slice(0, 8).map((attempt) => <article key={attempt.id}><span className={`activity-timeline__mark ${attempt.status === 'passed' ? 'is-passed' : ''}`}><CheckCircle2 /></span><div><strong>{attempt.exerciseTitle}</strong><small>{attempt.courseCode} · الشعبة {attempt.sectionCode} · المحاولة {attempt.attemptNumber}</small><time>{dateFormatter.format(new Date(attempt.submittedAt))}</time></div><em>{attemptStatusLabels[attempt.status] ?? attempt.status}</em></article>)}{!recentAttempts.length ? <p className="attempts-empty">لم يسجل الطالب أي محاولة بعد.</p> : null}</div></section>
    </div>
  </div>;
}

function academicPath(student) {
  return [student.departmentName, student.specializationName, student.levelName].filter(Boolean).join(' · ') || 'لا توجد بيانات أكاديمية';
}
