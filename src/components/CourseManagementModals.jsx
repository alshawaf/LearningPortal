import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { CourseFields } from './CreateModal';

export function EditCourseModal({ course, instructors, departments, onClose, onSaved }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      await apiFetch(`/courses/${course.id}`, { method: 'PATCH', body: JSON.stringify({
        code: values.get('code'), title: values.get('title'),
      }) });
      await onSaved('تم تحديث بيانات المقرر.');
    } catch (requestError) {
      setError(requestError.message || 'تعذر تحديث المقرر.');
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-course-title">
    <header><h2 id="edit-course-title">تعديل بيانات المقرر</h2><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X /></button></header>
    <form onSubmit={handleSubmit}>
      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      <CourseFields course={course} />
      <footer><button type="button" className="button button--outline" onClick={onClose}>إلغاء</button><button type="submit" className="button button--primary" disabled={submitting}>{submitting ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}</button></footer>
    </form>
  </section></div>;
}

export function ChangeCourseStatusModal({ course, onClose, onSaved }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const nextActive = !course.isActive;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await apiFetch(`/courses/${course.id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: nextActive }) });
      await onSaved(nextActive ? 'تم تفعيل المقرر.' : 'تم إيقاف المقرر.');
    } catch (requestError) {
      setError(requestError.message || 'تعذر تغيير حالة المقرر.');
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="modal-backdrop" role="presentation"><section className="modal modal--compact" role="dialog" aria-modal="true" aria-labelledby="course-status-title">
    <header><h2 id="course-status-title">{nextActive ? 'تفعيل المقرر' : 'إيقاف المقرر'}</h2><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X /></button></header>
    <div className="course-status-dialog">
      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      <span className={nextActive ? 'status-icon status-icon--active' : 'status-icon'}><AlertTriangle /></span>
      <p>{nextActive ? `سيصبح المقرر «${course.title}» متاحًا لإنشاء طروحات جديدة.` : `لن يمكن استخدام المقرر «${course.title}» في طروحات جديدة، مع بقاء الطروحات والسجلات السابقة محفوظة.`}</p>
      <footer><button type="button" className="button button--outline" onClick={onClose}>إلغاء</button><button type="button" className={`button ${nextActive ? 'button--primary' : 'button--danger'}`} onClick={handleSubmit} disabled={submitting}>{submitting ? 'جارٍ الحفظ...' : nextActive ? 'تفعيل' : 'إيقاف'}</button></footer>
    </div>
  </section></div>;
}
