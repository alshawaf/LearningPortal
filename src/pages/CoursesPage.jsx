import { BookOpen, ClipboardCheck, Code2, Pencil, Plus, Power, UserRoundCog, Users } from 'lucide-react';
import { useState } from 'react';
import { DataState, PageHeading, PrimaryButton, Progress } from '../components/Ui';
import { ChangeCourseStatusModal, EditCourseModal } from '../components/CourseManagementModals';
import CourseEnrollmentsModal from '../components/CourseEnrollmentsModal';
import { offeringContext } from '../lib/courseLabels';

export default function CoursesPage({ role, courses, instructors = [], departments = [], loading, error, onNavigate, onCreate, onRefresh }) {
  const [editingCourse, setEditingCourse] = useState(null);
  const [statusCourse, setStatusCourse] = useState(null);
  const [rosterCourse, setRosterCourse] = useState(null);
  const [notice, setNotice] = useState('');
  const handleSaved = async (message) => {
    await onRefresh();
    setEditingCourse(null);
    setStatusCourse(null);
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3000);
  };
  return <div className="stack-lg">
    <PageHeading
      title={role === 'student' ? 'مقرراتي' : role === 'admin' ? 'دليل المقررات' : 'مقرراتي'}
      description={role === 'admin' ? 'تعريفات المقررات العامة المستقلة عن الأعوام والشُّعب والأساتذة.' : undefined}
      action={role === 'admin' ? <PrimaryButton icon={false} onClick={onCreate}><Plus size={18} /> إضافة مقرر</PrimaryButton> : null}
    />
    <DataState loading={loading} error={error} empty={!courses.length}>
      <div className="course-catalog">
        {courses.map((course) => <article className="course-card" key={course.offeringId ?? course.id}>
          <div className="course-card__head"><span>{course.code}</span><div><em className={`status ${course.isActive ? 'status--success' : 'status--muted'}`}>{course.isActive ? 'نشط' : 'موقوف'}</em><Code2 /></div></div>
          <div className="course-card__body">{role==='admin'?<span className="course-card__offering">تعريف مستقل في دليل المقررات</span>:<span className="course-card__offering">{offeringContext(course)}</span>}<h2>{course.title}</h2>{role==='admin'?<><p className="course-card__teacher">يُربط بالأستاذ عند طرحه لشعبة</p><p className="course-card__path">{course.offeringCount} طرح مرتبط بهذا المقرر</p></>:<><p className="course-card__teacher">الأستاذ: <strong>{course.ownerName || 'لم يحدد أستاذ'}</strong></p><p className="course-card__path">{course.departmentName} ‹ {course.specializationName} ‹ {course.levelName}</p></>}</div>
          <div className="course-card__meta">{role==='admin'?<><span><BookOpen /> {course.offeringCount} طرح</span><span><Users /> دون طلاب مباشرين</span></>:<><span><BookOpen /> {course.assignmentCount} واجب</span><span><Users /> {course.memberCount} طالب</span></>}</div>
          {role === 'student' ? <Progress value={course.progress} /> : null}
          <footer className={`course-card__actions ${role === 'admin' ? 'course-card__actions--admin' : role === 'teacher' ? 'course-card__actions--teacher' : ''}`} aria-label={`إجراءات مقرر ${course.title}`}>
            {role === 'admin' ? <>
              <button onClick={() => setEditingCourse(course)} aria-label={`تعديل بيانات مقرر ${course.title}`}><Pencil /><span>تعديل البيانات</span></button>
              <button className={course.isActive ? 'is-danger' : 'is-activate'} onClick={() => setStatusCourse(course)} aria-label={`${course.isActive ? 'إيقاف' : 'تفعيل'} مقرر ${course.title}`}><Power /><span>{course.isActive ? 'إيقاف' : 'تفعيل'}</span></button>
            </> : null}
            {role === 'teacher' ? <button onClick={() => setRosterCourse(course)} aria-label={`عرض طلاب مقرر ${course.title}`}><UserRoundCog /><span>طلاب المقرر</span></button> : null}
            {role !== 'admin'?<button onClick={() => onNavigate('assignments')} aria-label={`${role === 'student' ? 'عرض' : 'إدارة'} واجبات مقرر ${course.title}`}><ClipboardCheck /><span>{role === 'student' ? 'عرض الواجبات' : 'إدارة الواجبات'}</span></button>:null}
          </footer>
        </article>)}
      </div>
    </DataState>
    {editingCourse ? <EditCourseModal course={editingCourse} instructors={instructors} departments={departments} onClose={() => setEditingCourse(null)} onSaved={handleSaved} /> : null}
    {statusCourse ? <ChangeCourseStatusModal course={statusCourse} onClose={() => setStatusCourse(null)} onSaved={handleSaved} /> : null}
    {rosterCourse ? <CourseEnrollmentsModal course={rosterCourse} role={role} onClose={() => setRosterCourse(null)} onChanged={onRefresh} /> : null}
    {notice ? <div className="toast" role="status">{notice}</div> : null}
  </div>;
}
