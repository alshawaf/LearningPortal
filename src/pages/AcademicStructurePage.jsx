import { BookMarked, Building2, ChevronDown, Layers3, Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { DataState, PageHeading, PrimaryButton } from '../components/Ui';

export default function AcademicStructurePage({ departments, loading, error, onRefresh }) {
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState('');
  const [expandedDepartments, setExpandedDepartments] = useState(() => new Set());

  const toggleDepartment = (departmentId) => {
    setExpandedDepartments((current) => {
      const next = new Set(current);
      if (next.has(departmentId)) next.delete(departmentId);
      else next.add(departmentId);
      return next;
    });
  };

  const handleCreated = async (message) => {
    await onRefresh();
    setModal(null);
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3000);
  };

  return <div className="stack-lg">
    <PageHeading
      title="الهيكل الأكاديمي"
      description="إدارة الدوائر والتخصصات والمستويات المرتبطة بالمقررات."
      action={<PrimaryButton icon={false} onClick={() => setModal({ type: 'department' })}><Plus size={18} /> إضافة دائرة</PrimaryButton>}
    />
    <DataState loading={loading} error={error} empty={!departments.length}>
      <div className="academic-grid">
        {departments.map((department) => {
          const isCollapsed = !expandedDepartments.has(department.id);
          const contentId = `department-${department.id}-specializations`;
          return <section className={`academic-department${isCollapsed ? ' is-collapsed' : ''}`} key={department.id}>
          <header className="academic-department__head">
            <button className="academic-department__toggle" type="button" onClick={() => toggleDepartment(department.id)} aria-expanded={!isCollapsed} aria-controls={contentId}>
              <span className="academic-department__icon"><Building2 size={22} /></span>
              <span className="academic-department__details"><small dir="ltr">{department.code}</small><strong>{department.name}</strong><span>{department.specializations.length} تخصص</span></span>
              <span className="academic-department__chevron" aria-hidden="true"><ChevronDown size={19} /></span>
            </button>
            <div className="academic-actions"><button className="table-action" onClick={() => setModal({ type: 'edit-department', department })}><Pencil size={14} /> تعديل</button><button className="table-action" onClick={() => setModal({ type: 'specialization', department })}><Plus size={15} /> إضافة تخصص</button></div>
          </header>
          {!isCollapsed ? <div className="academic-specializations" id={contentId}>
            {department.specializations.length ? department.specializations.map((specialization) => <article key={specialization.id}>
              <div className="academic-specialization__title">
                <span><BookMarked size={18} /></span>
                <div><h3>{specialization.name}</h3><small dir="ltr">{specialization.code}</small></div>
                <div className="academic-actions"><button className="table-action" onClick={() => setModal({ type: 'edit-specialization', specialization, department })}><Pencil size={14} /> تعديل</button><button className="table-action" onClick={() => setModal({ type: 'level', specialization, department })}><Plus size={14} /> إضافة مستوى</button></div>
              </div>
              <div className="academic-levels">
                {specialization.levels.length ? specialization.levels.map((level) => <button type="button" key={level.id} onClick={() => setModal({ type: 'edit-level', level, specialization, department })}><Layers3 size={14} /> {level.name}<Pencil size={12} /></button>) : <p>لا توجد مستويات في هذا التخصص بعد.</p>}
              </div>
            </article>) : <div className="academic-empty">لا توجد تخصصات في هذه الدائرة بعد.</div>}
          </div> : null}
        </section>;
        })}
      </div>
    </DataState>
    {modal ? <AcademicStructureModal modal={modal} onClose={() => setModal(null)} onCreated={handleCreated} /> : null}
    {notice ? <div className="toast" role="status">{notice}</div> : null}
  </div>;
}

function AcademicStructureModal({ modal, onClose, onCreated }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const titles = { department: 'إضافة دائرة جديدة', specialization: 'إضافة تخصص جديد', level: 'إضافة مستوى جديد', 'edit-department': 'تعديل بيانات الدائرة', 'edit-specialization': 'تعديل بيانات التخصص', 'edit-level': 'تعديل بيانات المستوى' };
  const isEdit = modal.type.startsWith('edit-');
  const entityType = modal.type.replace('edit-', '');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      if (entityType === 'department') {
        await apiFetch(isEdit ? `/academic-structure/departments/${modal.department.id}` : '/academic-structure/departments', { method: isEdit ? 'PATCH' : 'POST', body: JSON.stringify({ code: values.get('code'), name: values.get('name') }) });
        await onCreated(isEdit ? 'تم تحديث بيانات الدائرة.' : 'تمت إضافة الدائرة بنجاح.');
      } else if (entityType === 'specialization') {
        await apiFetch(isEdit ? `/academic-structure/specializations/${modal.specialization.id}` : `/academic-structure/departments/${modal.department.id}/specializations`, { method: isEdit ? 'PATCH' : 'POST', body: JSON.stringify({ code: values.get('code'), name: values.get('name') }) });
        await onCreated(isEdit ? 'تم تحديث بيانات التخصص.' : 'تمت إضافة التخصص إلى الدائرة بنجاح.');
      } else {
        await apiFetch(isEdit ? `/academic-structure/levels/${modal.level.id}` : `/academic-structure/specializations/${modal.specialization.id}/levels`, { method: isEdit ? 'PATCH' : 'POST', body: JSON.stringify({ number: Number(values.get('number')), name: values.get('name') }) });
        await onCreated(isEdit ? 'تم تحديث بيانات المستوى.' : 'تمت إضافة المستوى إلى التخصص بنجاح.');
      }
    } catch (requestError) {
      setError(requestError.message || 'تعذر حفظ البيانات.');
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="modal-backdrop" role="presentation"><section className="modal modal--compact" role="dialog" aria-modal="true" aria-labelledby="academic-modal-title">
    <header><h2 id="academic-modal-title">{titles[modal.type]}</h2><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X /></button></header>
    <form onSubmit={handleSubmit}>
      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      {entityType === 'specialization' ? <p className="modal-context">الدائرة: <strong>{modal.department.name}</strong></p> : null}
      {entityType === 'level' ? <p className="modal-context">{modal.department.name} ‹ <strong>{modal.specialization.name}</strong></p> : null}
      {entityType === 'level' ? <>
        <label>رقم المستوى<input name="number" type="number" min="1" max="20" required placeholder="1" defaultValue={modal.level?.number ?? ''} /></label>
        <label>اسم المستوى<input name="name" required minLength="2" maxLength="120" placeholder="المستوى الأول" defaultValue={modal.level?.name ?? ''} /></label>
      </> : <>
        <label>{entityType === 'department' ? 'رمز الدائرة' : 'رمز التخصص'}<input name="code" dir="ltr" required pattern="[A-Za-z0-9_-]{2,24}" maxLength="24" placeholder={entityType === 'department' ? 'IT' : 'CS'} defaultValue={entityType === 'department' ? modal.department?.code ?? '' : modal.specialization?.code ?? ''} /></label>
        <label>{entityType === 'department' ? 'اسم الدائرة' : 'اسم التخصص'}<input name="name" required minLength="2" maxLength="160" placeholder={entityType === 'department' ? 'دائرة تقنية المعلومات' : 'علوم الحاسوب'} defaultValue={entityType === 'department' ? modal.department?.name ?? '' : modal.specialization?.name ?? ''} /></label>
      </>}
      <footer><button type="button" className="button button--outline" onClick={onClose}>إلغاء</button><button type="submit" className="button button--primary" disabled={submitting}>{submitting ? 'جارٍ الحفظ...' : 'حفظ'}</button></footer>
    </form>
  </section></div>;
}
