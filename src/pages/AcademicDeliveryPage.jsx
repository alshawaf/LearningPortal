import { BookCopy, CalendarDays, Edit3, GraduationCap, Layers3, Plus, School, Search, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AcademicTermModal, AcademicYearModal, CohortModal, CourseOfferingModal, SectionModal } from '../components/AcademicDeliveryModals';
import SectionStudentsModal from '../components/SectionStudentsModal';
import { DataState, EmptyState, PageHeading } from '../components/Ui';
import { apiFetch } from '../lib/api';

const statusLabels={planned:'مخطط',active:'نشط',completed:'مكتمل',graduated:'متخرجة',archived:'مؤرشف'};
const tabs=[['offerings','الطروحات',BookCopy],['sections','الشُّعب',School],['cohorts','الدفعات',GraduationCap],['terms','الفصول',CalendarDays],['years','الأعوام',Layers3]];

export default function AcademicDeliveryPage({instructors,departments,onPlatformRefresh}){
 const [data,setData]=useState({years:[],terms:[],cohorts:[],sections:[],offerings:[],catalog:[]});const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [tab,setTab]=useState('offerings');const [query,setQuery]=useState('');const [modal,setModal]=useState(null);
 const load=useCallback(async()=>{setLoading(true);setError('');try{setData(await apiFetch('/course-offerings'));}catch(e){setError(e.message||'تعذر تحميل التنظيم الأكاديمي.');}finally{setLoading(false);}},[]);
 useEffect(()=>{void load();},[load]);
 const saved=async(message)=>{await Promise.all([load(),onPlatformRefresh()]);setModal(null);setNotice(message);window.setTimeout(()=>setNotice(''),3200);};
 const counts={offerings:data.offerings.length,sections:data.sections.length,cohorts:data.cohorts.length,terms:data.terms.length,years:data.years.length};
 const needle=query.trim().toLowerCase();
 const visible=useMemo(()=>data[tab].filter(item=>!needle||Object.values(item).some(value=>typeof value==='string'&&value.toLowerCase().includes(needle))),[data,needle,tab]);
 return <div className="stack-lg delivery-page"><PageHeading title="التنظيم والتشغيل الأكاديمي" description="إدارة الأعوام والفصول والدفعات والشُّعب، ثم طرح المقررات يدوياً للشُّعب." action={<button className="button button--primary" onClick={()=>setModal({type:singular(tab)})}><Plus/> {addLabel(tab)}</button>}/>
  <section className="delivery-summary" aria-label="ملخص التشغيل"><div><Layers3/><p><small>الأعوام الأكاديمية</small><strong>{data.years.length}</strong></p></div><div><GraduationCap/><p><small>الدفعات</small><strong>{data.cohorts.length}</strong></p></div><div><School/><p><small>الشُّعب</small><strong>{data.sections.length}</strong></p></div><div><BookCopy/><p><small>طروحات المقررات</small><strong>{data.offerings.length}</strong></p></div></section>
  <div className="delivery-tabs" role="tablist">{tabs.map(([value,label,Icon])=><button key={value} role="tab" aria-selected={tab===value} className={tab===value?'is-active':''} onClick={()=>{setTab(value);setQuery('');}}><Icon/>{label}<b>{counts[value]}</b></button>)}</div>
  <label className="delivery-search"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={`ابحث في ${tabs.find(item=>item[0]===tab)?.[1]}`}/></label>
  <DataState loading={loading} error={error} empty={false}>{visible.length?<div className="delivery-entity-grid">{visible.map(item=><EntityCard key={item.id} type={tab} item={item} onEdit={()=>setModal({type:singular(tab),value:item})} onStudents={tab==='sections'?()=>setModal({type:'students',value:item}):null}/>)}</div>:<EmptyState title="لا توجد بيانات" text={emptyText(tab)}/>}</DataState>
  {modal?<DeliveryModal modal={modal} data={data} instructors={instructors} departments={departments} onClose={()=>setModal(null)} onSaved={saved} onChanged={load}/>:null}
  {notice?<div className="toast" role="status">{notice}</div>:null}
 </div>;
}

function EntityCard({type,item,onEdit,onStudents}){
 const details=type==='offerings'?[`${item.courseCode} — ${item.courseTitle}`,`${item.sectionName} · ${item.termName}`,`الأستاذ: ${item.instructorName}`,`${item.studentCount} طالب`]:type==='sections'?[item.name,`${item.cohortName} · ${item.levelName}`,item.academicYearName,`${item.studentCount} طالب`]:type==='cohorts'?[item.name,item.specializationName,`سنة القبول ${item.admissionYear}`]:type==='terms'?[item.name,item.academicYearName,`الفصل رقم ${item.termNumber}`]:[item.name,item.code,dateRange(item)];
 return <article className="delivery-entity-card"><header><span className={`delivery-status delivery-status--${item.status}`}>{statusLabels[item.status]??item.status}</span><code>{item.code??item.courseCode}</code></header><div>{details.map((text,index)=>index===0?<h2 key={text}>{text}</h2>:<p key={`${text}-${index}`}>{text}</p>)}</div><footer>{onStudents?<button className="table-action" onClick={onStudents}><UsersRound/> الطلاب</button>:null}<button className="table-action" onClick={onEdit}><Edit3/> تعديل</button></footer></article>;
}
function DeliveryModal({modal,data,instructors,departments,onClose,onSaved,onChanged}){
 const props={onClose,onSaved};
 if(modal.type==='year')return <AcademicYearModal year={modal.value} {...props}/>;
 if(modal.type==='term')return <AcademicTermModal term={modal.value} years={data.years} {...props}/>;
 if(modal.type==='cohort')return <CohortModal cohort={modal.value} departments={departments} {...props}/>;
 if(modal.type==='section')return <SectionModal section={modal.value} cohorts={data.cohorts} years={data.years} departments={departments} {...props}/>;
 if(modal.type==='offering')return <CourseOfferingModal offering={modal.value} terms={data.terms} sections={data.sections} catalog={data.catalog} instructors={instructors} {...props}/>;
 if(modal.type==='students')return <SectionStudentsModal section={modal.value} onClose={onClose} onChanged={onChanged}/>;
 return null;
}
function singular(value){return{years:'year',terms:'term',cohorts:'cohort',sections:'section',offerings:'offering'}[value];}
function addLabel(value){return{years:'إضافة عام',terms:'إضافة فصل',cohorts:'إضافة دفعة',sections:'إضافة شعبة',offerings:'طرح مقرر'}[value];}
function emptyText(value){return{years:'أنشئ العام الأكاديمي أولاً.',terms:'أضف فصولاً دراسية تابعة لعام أكاديمي.',cohorts:'أنشئ دفعة مرتبطة بتخصص.',sections:'أنشئ شعبة لدفعة ومستوى وعام أكاديمي.',offerings:'اختر مقرراً وشعبة وفصلاً دراسياً لإنشاء أول طرح.'}[value];}
function dateRange(item){return item.startsOn||item.endsOn?`${item.startsOn??'بداية مفتوحة'} — ${item.endsOn??'نهاية مفتوحة'}`:'لم تحدد التواريخ';}
