import { Award, BarChart3, CheckCircle2 } from 'lucide-react';
import { DataState, PageHeading, Progress } from '../components/Ui';

export default function GradesPage({ assignments, courses, loading, error }) {
  const graded = assignments.filter((assignment) => assignment.latestScore != null);
  const earned = graded.reduce((sum, assignment) => sum + assignment.latestScore, 0);
  const possible = graded.reduce((sum, assignment) => sum + assignment.maxScore, 0);
  const average = possible ? Math.round((earned / possible) * 100) : 0;
  const courseGrades = courses.map((course) => {
    const items = graded.filter((assignment) => assignment.offeringId === course.offeringId);
    const courseEarned = items.reduce((sum, assignment) => sum + assignment.latestScore, 0);
    const coursePossible = items.reduce((sum, assignment) => sum + assignment.maxScore, 0);
    return { ...course, grade: coursePossible ? Math.round((courseEarned / coursePossible) * 100) : null };
  }).filter((course) => course.grade != null);

  return <div className="stack-lg"><PageHeading title="الدرجات" description="درجاتك المحفوظة فعليًا للتسليمات التي تم تقييمها." />
    <DataState loading={loading} error={error} empty={!graded.length}>
      <div className="grade-summary"><div><Award /><span><strong>{average}%</strong><small>المعدل العام</small></span></div><div><CheckCircle2 /><span><strong>{graded.length}</strong><small>تسليمات مقيّمة</small></span></div><div><BarChart3 /><span><strong>{earned}</strong><small>الدرجات المكتسبة</small></span></div></div>
      <section className="panel"><h2>أداء المقررات</h2>{courseGrades.map((course) => <div className="grade-row" key={course.offeringId}><div><strong>{course.title}</strong><small>{course.code} · {course.termName} · الشعبة {course.sectionCode}</small></div><Progress value={course.grade} /><b>{course.grade}%</b></div>)}</section>
    </DataState>
  </div>;
}
