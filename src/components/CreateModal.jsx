import { X } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { offeringLabel } from '../lib/courseLabels';
import Select from './Select';

const titles = { course: 'إضافة مقرر جديد', assignment: 'واجب برمجي جديد', user: 'إضافة مُستخدم جديد' };

export default function CreateModal({ type, courses, instructors = [], departments = [], onClose, onCreated }) {
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      if (type === 'course') {
        await apiFetch('/courses', { method: 'POST', body: JSON.stringify({ code: values.get('code'), title: values.get('title') }) });
      } else if (type === 'assignment') {
        const offeringId = values.get('offeringId');
        await apiFetch(`/course-offerings/${offeringId}/assignments`, { method: 'POST', body: JSON.stringify({
          title: values.get('title'), description: values.get('description'),
          dueAt: values.get('dueAt') ? new Date(values.get('dueAt')).toISOString() : null,
          maxScore: Number(values.get('maxScore')), publish: values.get('publish') === 'on',
          language: values.get('language'), starterCode: values.get('starterCode'),
        }) });
      } else {
        await apiFetch('/admin/users', { method: 'POST', body: JSON.stringify({
          displayName: values.get('displayName'), email: values.get('email'), phone: values.get('phone'),
          role: values.get('role'), temporaryPassword: values.get('temporaryPassword'),
          academicLevelId: values.get('academicLevelId') || null,
        }) });
      }
      await onCreated();
      setSaved(true);
      window.setTimeout(onClose, 900);
    } catch (requestError) {
      setError(requestError.message || 'تعذر حفظ البيانات.');
    } finally {
      setSubmitting(false);
    }
  };

  const cannotSubmit = submitting || (type === 'assignment' && !courses.length);
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div>{type === 'assignment' ? <small>إضافة إلى قاعدة البيانات</small> : null}<h2 id="modal-title">{titles[type]}</h2></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X /></button></header>{saved ? <div className="modal-success">تم الحفظ في قاعدة البيانات بنجاح</div> : <form onSubmit={handleSubmit}>{error ? <div className="auth-error" role="alert">{error}</div> : null}{type === 'course' ? <CourseFields instructors={instructors} departments={departments} /> : type === 'assignment' ? <AssignmentFields courses={courses} /> : <UserFields departments={departments} />}<footer><button type="button" className="button button--outline" onClick={onClose}>إلغاء</button><button className="button button--primary" type="submit" disabled={cannotSubmit}>{submitting ? 'جارٍ الحفظ...' : 'حفظ'}</button></footer></form>}</section></div>;
}

export function CourseFields({ course }) {
  return <>
    <label>رمز المقرر<input name="code" required placeholder="CS101" pattern="[A-Za-z0-9_-]{2,24}" defaultValue={course?.code ?? ''} /></label>
    <label>اسم المقرر<input name="title" required minLength="3" placeholder="مبادئ البرمجة" defaultValue={course?.title ?? ''} /></label>
    <p className="modal-note">المقرر تعريف عام مستقل. يتم ربطه بالشعبة والفصل والأستاذ لاحقاً من صفحة التشغيل الأكاديمي.</p>
  </>;
}

function AssignmentFields({ courses }) {
  return <><label>الشعبة الدراسية<Select name="offeringId" ariaLabel="الشعبة الدراسية" required options={courses.map((course) => ({ value: course.offeringId, label: offeringLabel(course) }))} placeholder={courses.length ? undefined : 'أضف مقررًا وشعبة أولًا'} disabled={!courses.length} /></label><label>عنوان الواجب<input name="title" required minLength="3" /></label><div className="form-row"><label>موعد التسليم<input name="dueAt" type="datetime-local" /></label><label>الدرجة العظمى<input name="maxScore" type="number" defaultValue="10" min="1" max="10000" required /></label></div><label>لغة البرمجة<Select name="language" ariaLabel="لغة البرمجة" options={[{ value: 'python', label: 'Python' }, { value: 'javascript', label: 'JavaScript' }]} /></label><label>الوصف<textarea name="description" placeholder="تعليمات الواجب..." /></label><label>الكود الابتدائي<textarea name="starterCode" dir="ltr" placeholder="# ابدأ الحل هنا" /></label><label className="check-label"><input name="publish" type="checkbox" /> نشر الواجب للطلاب فورًا</label></>;
}

export function AcademicLevelFields({ departments, initialDepartmentId = '', initialSpecializationId = '', initialLevelId = '' }) {
  const [departmentId, setDepartmentId] = useState(initialDepartmentId);
  const [specializationId, setSpecializationId] = useState(initialSpecializationId);
  const [levelId, setLevelId] = useState(initialLevelId);
  const selectedDepartment = departments.find((department) => department.id === departmentId);
  const specializations = selectedDepartment?.specializations ?? [];
  const selectedSpecialization = specializations.find((specialization) => specialization.id === specializationId);
  const levels = selectedSpecialization?.levels ?? [];

  const changeDepartment = (nextValue) => {
    setDepartmentId(nextValue);
    setSpecializationId('');
    setLevelId('');
  };
  const changeSpecialization = (nextValue) => {
    setSpecializationId(nextValue);
    setLevelId('');
  };

  return <>
    <label>الدائرة<Select ariaLabel="الدائرة" value={departmentId} onValueChange={changeDepartment} options={departments.map((department) => ({ value: department.id, label: department.name }))} placeholder="اختر الدائرة" required /></label>
    <label>التخصص<Select ariaLabel="التخصص" value={specializationId} onValueChange={changeSpecialization} options={specializations.map((specialization) => ({ value: specialization.id, label: specialization.name }))} placeholder="اختر التخصص" required disabled={!departmentId} /></label>
    <label>المستوى<Select name="academicLevelId" ariaLabel="المستوى" value={levelId} onValueChange={setLevelId} options={levels.map((level) => ({ value: level.id, label: level.name }))} placeholder="اختر المستوى" required disabled={!specializationId} /></label>
    {!departments.some((department) => department.specializations.some((specialization) => specialization.levels.length)) ? <p className="modal-warning">يجب إضافة دائرة وتخصص ومستوى نشط قبل إنشاء حساب طالب.</p> : null}
  </>;
}

function UserFields({ departments }) {
  const [role, setRole] = useState('student');
  return <><label>الاسم الكامل<input name="displayName" required minLength="2" /></label><label>البريد الإلكتروني<input name="email" type="email" required autoComplete="off" /></label><label>رقم الجوال<input name="phone" type="tel" dir="ltr" inputMode="tel" required placeholder="+967777123456" autoComplete="off" /></label><label>الدور<Select name="role" ariaLabel="الدور" value={role} onValueChange={setRole} options={[{ value: 'student', label: 'طالب' }, { value: 'instructor', label: 'أستاذ' }, { value: 'admin', label: 'مدير' }]} /></label>{role === 'student' ? <AcademicLevelFields departments={departments} /> : null}<label>كلمة مرور مؤقتة<input name="temporaryPassword" type="password" required minLength="8" maxLength="40" autoComplete="new-password" /></label><small>من 8 إلى 40 حرفًا وتحتوي على حروف وأرقام. سيُطلب من المستخدم تغييرها عند أول دخول.</small></>;
}
