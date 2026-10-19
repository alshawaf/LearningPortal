import { Activity, AlertTriangle, CheckCircle2, Clock3, Eye, Search, UserRoundCheck, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import Select from '../components/Select';
import StudentActivityModal from '../components/StudentActivityModal';
import { DataState, EmptyState, PageHeading, Progress } from '../components/Ui';
import { apiFetch } from '../lib/api';
import { offeringLabel } from '../lib/courseLabels';

const statusLabels = { all: 'جميع الحالات', active: 'نشط', not_started: 'لم يبدأ', inactive: 'غير نشط', struggling: 'متعثر', completed: 'مكتمل' };
const dateFormatter = new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeStyle: 'short' });

export default function StudentActivityPage({ role, courses }) {
  const [offeringId, setOfferingId] = useState('all'); const [status, setStatus] = useState('all'); const [query, setQuery] = useState('');
  const [data, setData] = useState({ summary: emptySummary, students: [] }); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);

  useEffect(() => {
    let active = true; setLoading(true); setError('');
    const suffix = offeringId === 'all' ? '' : `?offeringId=${encodeURIComponent(offeringId)}`;
    apiFetch(`/student-activity${suffix}`).then((value) => { if (active) setData(value); }).catch((caught) => { if (active) setError(caught.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [offeringId]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ar');
    return data.students.filter((student) => {
      if (status !== 'all' && student.status !== status) return false;
      if (!normalized) return true;
      return [student.displayName, student.departmentName, student.specializationName, student.levelName]
        .filter(Boolean).some((value) => value.toLocaleLowerCase('ar').includes(normalized));
    });
  }, [data.students, query, status]);

  const summary = data.summary;
  return <div className="stack-lg">
    <PageHeading title="نشاط الطلاب" description={role === 'admin' ? 'متابعة النشاط الأكاديمي عبر المقررات ضمن نطاق صلاحيات الإدارة.' : 'تابع تقدم طلاب مقرراتك وحدد من يحتاج إلى دعم مبكر.'} />
    <section className="activity-summary">
      <div><UsersRound /><span>إجمالي الطلاب</span><strong>{summary.studentCount}</strong></div>
      <div><Activity /><span>نشطون خلال 7 أيام</span><strong>{summary.activeCount}</strong></div>
      <div><CheckCircle2 /><span>أكملوا جميع التدريبات</span><strong>{summary.completedCount}</strong></div>
      <div className={summary.needsAttentionCount ? 'is-alert' : ''}><AlertTriangle /><span>يحتاجون إلى متابعة</span><strong>{summary.needsAttentionCount}</strong></div>
    </section>
    <div className="activity-filters">
      <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم الطالب أو بياناته الأكاديمية" /></label>
      <Select value={offeringId} onValueChange={setOfferingId} ariaLabel="تصفية حسب الشعبة" options={[{ value: 'all', label: 'جميع الشُّعب' }, ...courses.filter((course) => course.isActive).map((course) => ({ value: course.offeringId, label: offeringLabel(course) }))]} />
      <Select value={status} onValueChange={setStatus} ariaLabel="تصفية حسب حالة النشاط" options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} />
    </div>
    <DataState loading={loading} error={error} empty={false}>
      {!filtered.length ? <EmptyState title="لا توجد نتائج مطابقة" text={data.students.length ? 'جرّب تغيير حالة النشاط أو عبارة البحث.' : 'لا يوجد طلاب مسجلون في المقررات المتاحة لحسابك.'} /> : <div className="activity-table-shell"><table className="activity-table"><thead><tr><th>الطالب</th><th>البيانات الأكاديمية</th><th>التقدم</th><th>المحاولات</th><th>النقاط</th><th>آخر نشاط</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{filtered.map((student) => <tr key={student.studentId}>
        <td data-label="الطالب"><span className="activity-student"><i>{student.displayName.trim().charAt(0)}</i><span><strong>{student.displayName}</strong><small>{student.courseCount} مقرر</small></span></span></td>
        <td data-label="البيانات الأكاديمية"><span className="activity-academic"><strong>{student.specializationName ?? 'غير محدد'}</strong><small>{[student.departmentName, student.levelName].filter(Boolean).join(' · ') || '—'}</small></span></td>
        <td data-label="التقدم"><div className="activity-progress"><span><strong>{student.completedCount}/{student.exerciseCount}</strong><small>{student.completionRate}%</small></span><Progress value={student.completionRate} /></div></td>
        <td data-label="المحاولات">{student.attemptCount}</td><td data-label="النقاط">{student.points}</td>
        <td data-label="آخر نشاط">{student.lastActivityAt ? dateFormatter.format(new Date(student.lastActivityAt)) : 'لا يوجد'}</td>
        <td data-label="الحالة"><span className={`activity-status activity-status--${student.status}`}>{statusLabels[student.status]}</span></td>
        <td data-label="الإجراء"><button className="table-action" onClick={() => setSelectedStudent(student)}><Eye /> عرض النشاط</button></td>
      </tr>)}</tbody></table></div>}
      <p className="activity-count" aria-live="polite">عرض {filtered.length} من {data.students.length} طالب</p>
    </DataState>
    <aside className="activity-privacy-note"><UserRoundCheck /><div><strong>متابعة أكاديمية تحترم الخصوصية</strong><span>تُحتسب المؤشرات من الدخول والمحاولات والإكمال فقط، ولا تتم مراقبة كتابة الطالب أو نشاطه خارج المهام الأكاديمية.</span></div></aside>
    {selectedStudent ? <StudentActivityModal student={selectedStudent} offeringId={offeringId} onClose={() => setSelectedStudent(null)} /> : null}
  </div>;
}

const emptySummary = { studentCount: 0, activeCount: 0, completedCount: 0, notStartedCount: 0, needsAttentionCount: 0 };
