import { ArrowLeft, BookOpen, CalendarDays, CheckCircle2, Clock3, Code2 } from 'lucide-react';
import { DataState, EmptyState, PageHeading, PrimaryButton, Progress } from '../components/Ui';
import { offeringContext } from '../lib/courseLabels';

export default function StudentDashboard({ user, courses, assignments, loading, error, onNavigate, onOpenWorkspace }) {
  const submitted = assignments.filter((assignment) => assignment.latestSubmissionId).sort((a, b) => new Date(b.latestSubmittedAt) - new Date(a.latestSubmittedAt));
  const upcoming = assignments.filter((assignment) => !assignment.latestSubmissionId && assignment.dueAt && new Date(assignment.dueAt) >= new Date()).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
  return <div className="stack-lg">
    <section className="welcome-band"><div><h1>مرحباً، {user.displayName}</h1><p>بياناتك الأكاديمية محدثة مباشرة من المنصة</p></div><div className="welcome-band__art" aria-hidden="true"><BookOpen /><Code2 /></div></section>
    <DataState loading={loading} error={error} empty={false}>
      <div className="dashboard-grid"><main className="stack-lg"><section><PageHeading title="مقرراتك البرمجية" action={<button className="text-button" onClick={() => onNavigate('courses')}>عرض الكل <ArrowLeft size={16} /></button>} />
        {courses.length ? <div className="course-list">{courses.slice(0, 3).map((course) => <button className="course-row" key={course.offeringId} onClick={() => onNavigate('assignments')}><span className="course-icon"><Code2 size={22} /></span><span className="course-row__details"><strong>{course.title}</strong><small>{offeringContext(course)} · {course.completedCount} من {course.assignmentCount} واجبات مسلّمة</small></span><span className="course-row__progress"><Progress value={course.progress} /><b>{course.progress}%</b></span><ArrowLeft size={20} className="row-arrow" /></button>)}</div> : <EmptyState title="لا توجد مقررات" text="لم تتم إضافتك إلى أي شعبة دراسية حتى الآن." />}
      </section><section><PageHeading title="آخر النشاطات" />{submitted.length ? <div className="activity-list">{submitted.slice(0, 5).map((assignment) => <div key={assignment.latestSubmissionId}><span className="activity-icon blue">{assignment.latestStatus === 'graded' ? <CheckCircle2 /> : <Clock3 />}</span><p><strong>{assignment.latestStatus === 'graded' ? 'تم تقييم' : 'تم تسليم'} واجب {assignment.title}</strong><small>{new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(assignment.latestSubmittedAt))}</small></p></div>)}</div> : <EmptyState title="لا يوجد نشاط" text="ستظهر تسليماتك وتقييماتك هنا." />}</section></main>
      <aside className="next-assignment"><div className="section-title"><CalendarDays /><h2>الواجب القادم</h2></div>{upcoming ? <><div className="assignment-symbol"><Code2 /></div><h3>{upcoming.title}</h3><p>من مقرر {upcoming.courseTitle}</p><div className="deadline"><CalendarDays size={17} /><span>{new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(upcoming.dueAt))}</span></div><PrimaryButton onClick={() => onOpenWorkspace(upcoming)}>فتح الواجب</PrimaryButton></> : <EmptyState title="لا يوجد واجب قادم" text="لا توجد استحقاقات منشورة قادمة حاليًا." />}</aside></div>
    </DataState>
  </div>;
}
