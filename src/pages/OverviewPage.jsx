import { Activity, BookOpen, ClipboardCheck, Plus, Users } from 'lucide-react';
import { DataState, PageHeading, PrimaryButton, Progress } from '../components/Ui';
import { offeringContext } from '../lib/courseLabels';

export default function OverviewPage({ role, courses, assignments, people, loading, error, onNavigate, onCreate }) {
  const admin = role === 'admin';
  const students = people.filter((person) => person.role === 'student');
  const activeCourses = courses.filter((course) => course.isActive);
  const today = new Date().toDateString();
  const dueToday = assignments.filter((assignment) => assignment.dueAt && new Date(assignment.dueAt).toDateString() === today).length;
  const activePeople = people.filter((person) => person.lastLoginAt && Date.now() - new Date(person.lastLoginAt).getTime() <= 7 * 86400000).length;
  const activityRate = people.length ? Math.round((activePeople / people.length) * 100) : 0;
  const maxAssignments = Math.max(1, ...courses.map((course) => course.assignmentCount));
  const overdue = assignments.filter((assignment) => assignment.dueAt && new Date(assignment.dueAt) < new Date() && assignment.publishedAt).length;
  const emptyCourses = courses.filter((course) => course.assignmentCount === 0).length;
  const inactiveStudents = students.filter((student) => !student.lastLoginAt).length;

  return <div className="stack-lg">
    <PageHeading title={admin ? 'نظرة عامة على المنصة' : 'لوحة المقررات'} description="ملخص مباشر من قاعدة بيانات المنصة." action={<PrimaryButton icon={false} onClick={onCreate}><Plus size={18} /> {admin ? 'إضافة مقرر' : 'واجب جديد'}</PrimaryButton>} />
    <DataState loading={loading} error={error} empty={false}>
      <div className="stat-strip"><div><span><Users /></span><p><small>{admin ? 'إجمالي الطلاب' : 'الطلاب المسجلون'}</small><strong>{students.length}</strong></p></div><div><span><BookOpen /></span><p><small>المقررات النشطة</small><strong>{activeCourses.length}</strong></p></div><div><span><ClipboardCheck /></span><p><small>استحقاقات اليوم</small><strong>{dueToday}</strong></p></div><div><span><Activity /></span><p><small>نشطون خلال 7 أيام</small><strong>{activityRate}%</strong></p></div></div>
      <div className="overview-columns"><section className="panel"><div className="panel__title"><h2>نشاط المقررات</h2><button className="text-button" onClick={() => onNavigate('courses')}>عرض التفاصيل</button></div>{courses.length ? courses.slice(0, 5).map((course) => <div className="metric-row" key={course.offeringId}><div><strong>{course.title}</strong><small>{offeringContext(course)} · {course.memberCount} طالب</small></div><Progress value={Math.round((course.assignmentCount / maxAssignments) * 100)} /><b>{course.assignmentCount} واجب</b></div>) : <p className="muted-copy">لا توجد مقررات مسجلة بعد.</p>}</section><section className="panel"><div className="panel__title"><h2>يحتاج إلى انتباهك</h2></div><div className="attention-list"><div><i>{overdue}</i><p><strong>واجبات تجاوزت موعدها</strong><small>من الواجبات المنشورة</small></p></div><div><i>{emptyCourses}</i><p><strong>مقررات بلا واجبات</strong><small>تحتاج إلى محتوى أكاديمي</small></p></div><div><i>{inactiveStudents}</i><p><strong>طلاب لم يسجلوا الدخول</strong><small>وفق سجل الدخول الفعلي</small></p></div></div></section></div>
    </DataState>
  </div>;
}
