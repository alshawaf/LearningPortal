import { ShieldCheck, Users, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export default function CourseEnrollmentsModal({course,role,onClose}){
 const [data,setData]=useState(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const load=useCallback(async()=>{setLoading(true);setError('');try{setData(await apiFetch(`/course-offerings/${course.offeringId}/enrollments`));}catch(e){setError(e.message||'تعذر تحميل طلاب الشعبة.');}finally{setLoading(false);}},[course.offeringId]);
 useEffect(()=>{void load();},[load]);
 return <div className="modal-backdrop" role="presentation"><section className="modal modal--roster" role="dialog" aria-modal="true" aria-labelledby="roster-modal-title"><header><div><h2 id="roster-modal-title">طلاب المقرر</h2><small>{course.code} · {course.title} · {course.termName} · الشعبة {course.sectionCode}</small></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X/></button></header><div className="roster-content">
  {error?<div className="auth-error" role="alert">{error}</div>:null}{loading?<div className="data-state">جارٍ تحميل الطلاب...</div>:null}
  {data?<><div className="roster-context"><ShieldCheck/><p><strong>{data.course.specializationName} ‹ {data.course.levelName}</strong><span>{role==='admin'?'تُدار عضوية الطلاب مركزياً من الشعبة وتنعكس على جميع مقرراتها.':'تظهر بيانات طلاب الشعبة المرتبطين بهذا الطرح.'}</span></p></div><div className="roster-list">{data.enrollments.length?data.enrollments.map(student=><article className="roster-student" key={student.studentId}><span className="roster-avatar">{student.displayName[0]}</span><div className="roster-student__identity"><strong>{student.displayName}</strong><span>{student.specializationName} ‹ {student.levelName}</span>{role==='admin'?<small dir="ltr">{student.email}{student.phone?` · ${student.phone}`:''}</small>:null}</div><div className="roster-student__meta"><em className={`enrollment-badge enrollment-badge--${student.status}`}>{student.status==='active'?'نشط':student.status}</em><span>عضو في الشعبة</span></div></article>):<div className="academic-empty"><Users/><p>لا يوجد طلاب نشطون في الشعبة.</p></div>}</div></>:null}
 </div><footer><button className="button button--outline" type="button" onClick={onClose}>إغلاق</button></footer></section></div>;
}
