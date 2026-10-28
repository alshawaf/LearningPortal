import { CalendarRange, GraduationCap, Layers3, School, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatDateOnly } from '../lib/date';
import Select from './Select';

const deliveryStatuses=[{value:'planned',label:'مخطط'},{value:'active',label:'نشط'},{value:'completed',label:'مكتمل'},{value:'archived',label:'مؤرشف'}];
const cohortStatuses=[{value:'planned',label:'مخططة'},{value:'active',label:'نشطة'},{value:'graduated',label:'متخرجة'},{value:'archived',label:'مؤرشفة'}];

export function AcademicYearModal({year,onClose,onSaved}){
 return <EntityModal title={year?'تعديل العام الأكاديمي':'إضافة عام أكاديمي'} icon={<CalendarRange/>} endpoint={year?`/course-offerings/years/${year.id}`:'/course-offerings/years'} method={year?'PATCH':'POST'} onClose={onClose} onSaved={()=>onSaved(year?'تم تحديث العام الأكاديمي.':'تم إنشاء العام الأكاديمي.')} transform={calendarValues}>
  <label>رمز العام<input name="code" required pattern="[A-Za-z0-9_-]{2,24}" defaultValue={year?.code??''} placeholder="2026-2027" dir="ltr"/></label>
  <label>اسم العام<input name="name" required minLength="2" maxLength="120" defaultValue={year?.name??''} placeholder="العام الأكاديمي 2026/2027"/></label>
  <DateFields value={year}/><label>الحالة<Select name="status" ariaLabel="حالة العام" defaultValue={year?.status??'planned'} options={deliveryStatuses}/></label>
 </EntityModal>;
}

export function AcademicTermModal({term,years,onClose,onSaved}){
 return <EntityModal title={term?'تعديل الفصل الدراسي':'إضافة فصل دراسي'} icon={<CalendarRange/>} endpoint={term?`/course-offerings/terms/${term.id}`:'/course-offerings/terms'} method={term?'PATCH':'POST'} onClose={onClose} onSaved={()=>onSaved(term?'تم تحديث الفصل الدراسي.':'تم إنشاء الفصل الدراسي.')} transform={(v)=>({...calendarValues(v),termNumber:Number(v.termNumber)})}>
  <label>العام الأكاديمي<Select name="academicYearId" ariaLabel="العام الأكاديمي" required defaultValue={term?.academicYearId??''} options={years.map(item=>({value:item.id,label:item.name}))} placeholder="اختر العام"/></label>
  <div className="form-row"><label>ترتيب الفصل<input name="termNumber" type="number" min="1" max="6" required defaultValue={term?.termNumber??1}/></label><label>رمز الفصل<input name="code" required pattern="[A-Za-z0-9_-]{2,24}" defaultValue={term?.code??''} placeholder="2026-T1" dir="ltr"/></label></div>
  <label>اسم الفصل<input name="name" required minLength="2" maxLength="120" defaultValue={term?.name??''} placeholder="الفصل الدراسي الأول"/></label>
  <DateFields value={term}/><label>الحالة<Select name="status" ariaLabel="حالة الفصل" defaultValue={term?.status??'planned'} options={deliveryStatuses}/></label>
 </EntityModal>;
}

export function CohortModal({cohort,departments,onClose,onSaved}){
 const specializations=departments.flatMap(d=>d.specializations.map(s=>({value:s.id,label:`${d.name} — ${s.name}`})));
 return <EntityModal title={cohort?'تعديل بيانات الدفعة':'إضافة دفعة طلاب'} icon={<GraduationCap/>} endpoint={cohort?`/course-offerings/cohorts/${cohort.id}`:'/course-offerings/cohorts'} method={cohort?'PATCH':'POST'} onClose={onClose} onSaved={()=>onSaved(cohort?'تم تحديث الدفعة.':'تم إنشاء الدفعة.')} transform={(v)=>({...v,admissionYear:Number(v.admissionYear)})}>
  <label>التخصص<Select name="specializationId" ariaLabel="تخصص الدفعة" required defaultValue={cohort?.specializationId??''} options={specializations} placeholder="اختر التخصص"/></label>
  <div className="form-row"><label>رمز الدفعة<input name="code" required pattern="[A-Za-z0-9_-]{2,32}" defaultValue={cohort?.code??''} placeholder="IT2026" dir="ltr"/></label><label>سنة القبول<input name="admissionYear" type="number" min="2000" max="2200" required defaultValue={cohort?.admissionYear??new Date().getFullYear()}/></label></div>
  <label>اسم الدفعة<input name="name" required minLength="2" maxLength="160" defaultValue={cohort?.name??''} placeholder="دفعة تقنية المعلومات 2026"/></label>
  <label>الحالة<Select name="status" ariaLabel="حالة الدفعة" defaultValue={cohort?.status??'active'} options={cohortStatuses}/></label>
 </EntityModal>;
}

export function SectionModal({section,cohorts,years,departments,onClose,onSaved}){
 const [cohortId,setCohortId]=useState(section?.cohortId??'');
 const [levelId,setLevelId]=useState(section?.levelId??'');
 const selected=cohorts.find(item=>item.id===cohortId);
 const levels=departments.flatMap(d=>d.specializations).find(s=>s.id===selected?.specializationId)?.levels??[];
 const changeCohort=(nextCohortId)=>{setCohortId(nextCohortId);const nextCohort=cohorts.find(item=>item.id===nextCohortId);const nextLevels=departments.flatMap(d=>d.specializations).find(item=>item.id===nextCohort?.specializationId)?.levels??[];if(!nextLevels.some(item=>item.id===levelId))setLevelId('');};
 return <EntityModal title={section?'تعديل بيانات الشعبة':'إضافة شعبة دراسية'} icon={<School/>} endpoint={section?`/course-offerings/sections/${section.id}`:'/course-offerings/sections'} method={section?'PATCH':'POST'} onClose={onClose} onSaved={()=>onSaved(section?'تم تحديث الشعبة.':'تم إنشاء الشعبة.')}>
  <label>الدفعة<Select name="cohortId" ariaLabel="الدفعة" required value={cohortId} onValueChange={changeCohort} options={cohorts.map(item=>({value:item.id,label:`${item.name} — ${item.specializationName}`}))} placeholder="اختر الدفعة"/></label>
  <div className="form-row"><label>المستوى<Select name="levelId" ariaLabel="مستوى الشعبة" required value={levelId} onValueChange={setLevelId} options={levels.map(item=>({value:item.id,label:item.name}))} placeholder="اختر المستوى" disabled={!cohortId}/></label><label>العام الأكاديمي<Select name="academicYearId" ariaLabel="عام الشعبة" required defaultValue={section?.academicYearId??''} options={years.map(item=>({value:item.id,label:item.name}))} placeholder="اختر العام"/></label></div>
  <div className="form-row"><label>رمز الشعبة<input name="code" required pattern="[A-Za-z0-9_-]{1,32}" defaultValue={section?.code??''} placeholder="A" dir="ltr"/></label><label>اسم الشعبة<input name="name" required minLength="2" maxLength="160" defaultValue={section?.name??''} placeholder="الشعبة A"/></label></div>
  <label>الحالة<Select name="status" ariaLabel="حالة الشعبة" defaultValue={section?.status??'active'} options={deliveryStatuses}/></label>
 </EntityModal>;
}

export function CourseOfferingModal({offering,terms,sections,catalog,instructors,onClose,onSaved}){
 const [sectionId,setSectionId]=useState(offering?.sectionId??'');
 const [termId,setTermId]=useState(offering?.termId??'');
 const selectedSection=sections.find(item=>item.id===sectionId);
 const availableTerms=useMemo(()=>terms.filter(item=>!selectedSection||item.academicYearId===selectedSection.academicYearId),[selectedSection,terms]);
 const changeSection=(nextSectionId)=>{setSectionId(nextSectionId);const nextSection=sections.find(item=>item.id===nextSectionId);if(!terms.some(item=>item.id===termId&&item.academicYearId===nextSection?.academicYearId))setTermId('');};
 return <EntityModal wide title={offering?'تعديل طرح المقرر':'طرح مقرر لشعبة'} icon={<Layers3/>} endpoint={offering?`/course-offerings/${offering.id}`:'/course-offerings'} method={offering?'PATCH':'POST'} onClose={onClose} onSaved={()=>onSaved(offering?'تم تحديث طرح المقرر.':'تم طرح المقرر للشعبة.')}>
  <div className="delivery-form-intro"><Layers3/><p><strong>الطرح هو علاقة المقرر بالشعبة داخل فصل دراسي.</strong><span>يحصل طلاب الشعبة على المقرر وأنشطته تلقائياً، بينما يبقى تعريف المقرر مستقلاً.</span></p></div>
  <label>الشعبة<Select name="sectionId" ariaLabel="الشعبة" required value={sectionId} onValueChange={changeSection} options={sections.filter(item=>item.status==='active'||item.id===sectionId).map(item=>({value:item.id,label:`${item.name} — ${item.cohortName} — ${item.academicYearName}`}))} placeholder="اختر الشعبة"/></label>
  <div className="form-row"><label>الفصل الدراسي<Select name="termId" ariaLabel="الفصل الدراسي" required value={termId} onValueChange={setTermId} options={availableTerms.map(item=>({value:item.id,label:`${item.name} — ${item.academicYearName}`}))} placeholder={sectionId?'اختر الفصل':'اختر الشعبة أولاً'} disabled={!sectionId}/></label><label>المقرر<Select name="courseId" ariaLabel="المقرر" required defaultValue={offering?.courseId??''} options={catalog.filter(item=>item.isActive||item.id===offering?.courseId).map(item=>({value:item.id,label:`${item.code} — ${item.title}`}))} placeholder="اختر المقرر"/></label></div>
  <label>الأستاذ<Select name="instructorUserId" ariaLabel="أستاذ الطرح" required defaultValue={offering?.instructorUserId??''} options={instructors.map(item=>({value:item.id,label:item.displayName}))} placeholder="اختر الأستاذ"/></label>
  <label>الحالة<Select name="status" ariaLabel="حالة الطرح" defaultValue={offering?.status??'planned'} options={deliveryStatuses}/></label>
  {offering?<p className="modal-note">بعد إضافة أنشطة لا يمكن تغيير المقرر أو الشعبة أو الفصل، ويمكن تغيير الأستاذ والحالة.</p>:null}
 </EntityModal>;
}

function EntityModal({title,icon,endpoint,method,onClose,onSaved,transform=(value)=>value,wide=false,children}){
 const [submitting,setSubmitting]=useState(false);const [error,setError]=useState('');
 const submit=async(event)=>{event.preventDefault();setSubmitting(true);setError('');const values=Object.fromEntries(new FormData(event.currentTarget));try{await apiFetch(endpoint,{method,body:JSON.stringify(transform(values))});await onSaved();}catch(requestError){setError(requestError.message||'تعذر حفظ البيانات.');}finally{setSubmitting(false);}};
 return <div className="modal-backdrop" role="presentation"><section className={`modal ${wide?'modal--delivery':''}`} role="dialog" aria-modal="true" aria-labelledby="delivery-modal-title"><header><div className="delivery-modal-title"><span>{icon}</span><h2 id="delivery-modal-title">{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق"><X/></button></header><form onSubmit={submit}>{error?<div className="auth-error" role="alert">{error}</div>:null}{children}<footer><button type="button" className="button button--outline" onClick={onClose}>إلغاء</button><button type="submit" className="button button--primary" disabled={submitting}>{submitting?'جارٍ الحفظ...':'حفظ'}</button></footer></form></section></div>;
}
function DateFields({value}){return <div className="form-row"><label>تاريخ البداية <span className="field-hint">(اختياري)</span><input name="startsOn" type="date" defaultValue={dateValue(value?.startsOn)}/></label><label>تاريخ النهاية <span className="field-hint">(اختياري)</span><input name="endsOn" type="date" defaultValue={dateValue(value?.endsOn)}/></label></div>;}
function dateValue(value){return formatDateOnly(value);}
function calendarValues(value){return{...value,startsOn:value.startsOn||null,endsOn:value.endsOn||null};}
