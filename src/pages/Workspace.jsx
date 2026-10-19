import { ArrowRight, Check, ChevronLeft, Clock3, Code2, Send, Terminal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import Brand from '../components/Brand';

export default function Workspace({ assignment, role, onBack, onSubmitted }) {
  const instructor = role === 'teacher' || role === 'admin';
  const [code, setCode] = useState(assignment.starterCode || '');
  const [activeTab, setActiveTab] = useState(instructor ? 'submissions' : 'problem');
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const lines = useMemo(() => Math.max(1, code.split('\n').length), [code]);

  useEffect(() => {
    let active = true;
    apiFetch(`/assignments/${assignment.id}/submissions`).then((result) => {
      if (active) setSubmissions(result.submissions);
    }).catch((requestError) => { if (active) setError(requestError.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [assignment.id]);

  const submit = async () => {
    setSubmitting(true); setError('');
    try {
      const result = await apiFetch(`/assignments/${assignment.id}/submissions`, { method: 'POST', body: JSON.stringify({ sourceCode: code }) });
      setSubmissions((current) => [result.submission, ...current]);
      setSaved(true);
      await onSubmitted();
      window.setTimeout(() => setSaved(false), 2500);
    } catch (requestError) { setError(requestError.message); }
    finally { setSubmitting(false); }
  };

  const latest = submissions[0];
  return <div className="workspace" dir="rtl">
    <header className="workspace__header"><Brand compact /><div className="workspace__title"><small>{assignment.courseTitle} / الواجبات</small><h1>{assignment.title}</h1></div><span className="attempt">{submissions.length} محاولة</span><button className="back-button" onClick={onBack}><ArrowRight size={18} /> العودة</button></header>
    <div className="workspace__grid">
      <aside className="problem-pane"><div className="workspace-tabs"><button className={activeTab === 'problem' ? 'active' : ''} onClick={() => setActiveTab('problem')}>المسألة</button><button className={activeTab === 'results' ? 'active' : ''} onClick={() => setActiveTab('results')}>النتائج</button><button className={activeTab === 'submissions' ? 'active' : ''} onClick={() => setActiveTab('submissions')}>التسليمات</button></div>
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {activeTab === 'problem' ? <div className="problem-copy"><h2>المطلوب</h2><p>{assignment.description || 'لم يضف الأستاذ وصفًا لهذا الواجب.'}</p><h3>لغة البرمجة</h3><p>{assignment.language === 'javascript' ? 'JavaScript' : 'Python'}</p><h3>الدرجة العظمى</h3><p>{assignment.maxScore}</p></div> : activeTab === 'results' ? <div className="problem-copy"><h2>نتيجة آخر تسليم</h2>{latest?.score != null ? <><div className="result-score">{latest.score} / {assignment.maxScore}</div><p>{latest.feedback || 'لا توجد ملاحظات.'}</p></> : <p>{latest ? 'تم حفظ التسليم وهو بانتظار التقييم.' : 'لم يتم تسليم حل بعد.'}</p>}</div> : <div className="problem-copy"><h2>التسليمات المحفوظة</h2>{loading ? <p>جارٍ التحميل...</p> : submissions.length ? submissions.map((submission) => <p key={submission.id}>المحاولة {submission.attemptNumber} — {submission.score == null ? 'بانتظار التقييم' : `${submission.score} / ${assignment.maxScore}`}</p>) : <p>لا توجد تسليمات.</p>}</div>}
        {!instructor ? <div className="problem-actions"><button className="button button--outline" type="button" disabled title="سيضاف محرك التنفيذ المعزول في مرحلة مستقلة"><Terminal size={17} />التشغيل غير متاح</button><button className="button button--primary" onClick={submit} disabled={submitting || !code.trim()}><Send size={17} />{submitting ? 'جارٍ التسليم...' : 'تسليم الحل'}</button></div> : null}
      </aside>
      <main className="editor-pane"><div className="editor-toolbar"><span><Code2 size={16} /> solution.{assignment.language === 'javascript' ? 'js' : 'py'}</span><button>{assignment.language === 'javascript' ? 'JavaScript' : 'Python 3'} <ChevronLeft size={14} /></button></div><div className="code-area"><div className="line-numbers" aria-hidden="true">{Array.from({ length: lines }, (_, index) => <span key={index}>{index + 1}</span>)}</div><div className="editor-code-wrap"><textarea value={code} onChange={(event) => setCode(event.target.value)} readOnly={instructor} spellCheck="false" aria-label="محرر الكود" dir="ltr" /></div></div><div className="console"><div className="console__head"><span><Terminal size={15} /> حالة التسليم</span><small>بيانات حقيقية من قاعدة البيانات</small></div><pre dir="rtl">{latest ? `آخر محاولة: ${latest.attemptNumber}\nالحالة: ${latest.score == null ? 'بانتظار التقييم' : 'تم التقييم'}` : 'لا توجد محاولة محفوظة حتى الآن.'}</pre></div></main>
      <aside className="tests-pane"><h2>حالة التقييم</h2><div className="score"><strong>{latest?.score ?? '—'} / {assignment.maxScore}</strong><small>الدرجة المسجلة</small></div><button className={`test-item ${latest?.score != null ? 'passed' : 'review'}`}><span>{latest?.score != null ? <Check /> : <Clock3 />}</span><p><strong>{latest?.score != null ? 'تم التقييم' : 'بانتظار التقييم'}</strong><small>لا تُعرض نتائج اختبارات وهمية</small></p><ChevronLeft size={17} /></button></aside>
    </div>{saved ? <div className="toast"><Check size={18} /> تم حفظ التسليم في قاعدة البيانات.</div> : null}
  </div>;
}
