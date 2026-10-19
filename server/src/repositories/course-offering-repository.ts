import type { AuthUser } from '../domain/auth.js';
import { withUserContext } from '../db/pool.js';

type CalendarInput = { code: string; name: string; startsOn: string | null; endsOn: string | null; status: string };

export class CourseOfferingRepository {
  list(user: AuthUser) {
    return withUserContext(user, async (client) => {
      const years = await client.query(`select id,code,name,starts_on,ends_on,status from app.academic_years order by starts_on desc nulls last,created_at desc`);
      const terms = await client.query(`select t.id,t.academic_year_id,t.term_number,t.code,t.name,t.starts_on,t.ends_on,t.status,t.is_system,
                             y.name as academic_year_name,y.code as academic_year_code
                      from app.academic_terms t join app.academic_years y on y.id=t.academic_year_id
                      order by y.starts_on desc nulls last,t.term_number`);
      const cohorts = await client.query(`select c.id,c.specialization_id,c.code,c.name,c.admission_year,c.status,
                             s.name as specialization_name,d.id as department_id,d.name as department_name
                      from app.student_cohorts c join app.specializations s on s.id=c.specialization_id
                      join app.academic_departments d on d.id=s.department_id
                      order by c.admission_year desc,s.name,c.name`);
      const sections = await client.query(`select x.id,x.cohort_id,x.level_id,x.academic_year_id,x.code,x.name,x.status,
                             c.name as cohort_name,c.admission_year,l.name as level_name,l.level_number,
                             s.id as specialization_id,s.name as specialization_name,d.id as department_id,d.name as department_name,
                             y.name as academic_year_name,
                             (select count(*) from app.section_memberships m where m.section_id=x.id and m.status='active') as student_count
                      from app.academic_sections x join app.student_cohorts c on c.id=x.cohort_id
                      join app.academic_levels l on l.id=x.level_id join app.specializations s on s.id=l.specialization_id
                      join app.academic_departments d on d.id=s.department_id join app.academic_years y on y.id=x.academic_year_id
                      order by y.starts_on desc nulls last,s.name,l.level_number,x.code`);
      const offerings = await client.query(`select o.id,o.course_id,c.code as course_code,c.title as course_title,o.term_id,t.code as term_code,t.name as term_name,
                             t.academic_year_id,y.name as academic_year_name,o.section_id,x.code as section_code,x.name as section_name,
                             x.level_id,l.name as level_name,s.name as specialization_name,
                             o.instructor_user_id,u.display_name as instructor_name,o.status,o.created_at,o.updated_at,
                             (select count(*) from app.section_memberships m where m.section_id=o.section_id and m.status='active') as student_count
                      from app.course_offerings o join app.courses c on c.id=o.course_id
                      join app.academic_terms t on t.id=o.term_id join app.academic_years y on y.id=t.academic_year_id
                      join app.academic_sections x on x.id=o.section_id join app.academic_levels l on l.id=x.level_id
                      join app.specializations s on s.id=l.specialization_id join app.users u on u.id=o.instructor_user_id
                      order by y.starts_on desc nulls last,t.term_number,c.code,x.code`);
      const catalog = await client.query(`select id,code,title,is_active,created_at,updated_at from app.courses order by code`);
      return {
        years: years.rows.map(mapYear),
        terms: terms.rows.map(mapTerm),
        cohorts: cohorts.rows.map((row) => ({ id: row.id, specializationId: row.specialization_id, specializationName: row.specialization_name,
          departmentId: row.department_id, departmentName: row.department_name, code: row.code, name: row.name,
          admissionYear: row.admission_year, status: row.status })),
        sections: sections.rows.map((row) => ({ id: row.id, cohortId: row.cohort_id, cohortName: row.cohort_name,
          admissionYear: row.admission_year, levelId: row.level_id, levelName: row.level_name, levelNumber: row.level_number,
          academicYearId: row.academic_year_id, academicYearName: row.academic_year_name, code: row.code, name: row.name,
          status: row.status, specializationId: row.specialization_id, specializationName: row.specialization_name,
          departmentId: row.department_id, departmentName: row.department_name, studentCount: Number(row.student_count) })),
        offerings: offerings.rows.map(mapOffering),
        catalog: catalog.rows.map((row) => ({ id: row.id, code: row.code, title: row.title, isActive: row.is_active,
          createdAt: row.created_at, updatedAt: row.updated_at })),
      };
    });
  }

  createYear(user: AuthUser, input: CalendarInput) { return this.insertAudited(user, `insert into app.academic_years(code,name,starts_on,ends_on,status) values($1,$2,$3,$4,$5) returning id`, [input.code,input.name,input.startsOn,input.endsOn,input.status], 'academic_year.create', 'academic_year', input); }
  updateYear(user: AuthUser, id: string, input: CalendarInput) { return this.updateAudited(user, `update app.academic_years set code=$2,name=$3,starts_on=$4,ends_on=$5,status=$6,updated_at=now() where id=$1 returning id`, [id,input.code,input.name,input.startsOn,input.endsOn,input.status], 'academic_year.update', 'academic_year', id, input); }
  createTerm(user: AuthUser, input: CalendarInput & { academicYearId: string; termNumber: number }) { return this.insertAudited(user, `insert into app.academic_terms(academic_year_id,term_number,code,name,starts_on,ends_on,status) values($1,$2,$3,$4,$5,$6,$7) returning id`, [input.academicYearId,input.termNumber,input.code,input.name,input.startsOn,input.endsOn,input.status], 'academic_term.create', 'academic_term', input); }
  updateTerm(user: AuthUser, id: string, input: CalendarInput & { academicYearId: string; termNumber: number }) { return withUserContext(user, async (client) => { const current=await client.query(`select academic_year_id,exists(select 1 from app.course_offerings where term_id=$1) as is_used from app.academic_terms where id=$1 for update`,[id]);if(!current.rows[0])throw notFoundError();if(current.rows[0].academic_year_id!==input.academicYearId&&current.rows[0].is_used)throw academicContextLockedError();const result=await client.query(`update app.academic_terms set academic_year_id=$2,term_number=$3,code=$4,name=$5,starts_on=$6,ends_on=$7,status=$8,updated_at=now() where id=$1 returning id`,[id,input.academicYearId,input.termNumber,input.code,input.name,input.startsOn,input.endsOn,input.status]);if(!result.rows[0])throw notFoundError();await client.query(`select app.write_audit($1,'academic_term.update','academic_term',$2,$3::jsonb,null)`,[user.id,id,JSON.stringify(input)]);}); }
  createCohort(user: AuthUser, input: { specializationId: string; code: string; name: string; admissionYear: number; status: string }) { return this.insertAudited(user, `insert into app.student_cohorts(specialization_id,code,name,admission_year,status) values($1,$2,$3,$4,$5) returning id`, [input.specializationId,input.code,input.name,input.admissionYear,input.status], 'student_cohort.create', 'student_cohort', input); }
  updateCohort(user: AuthUser, id: string, input: { specializationId: string; code: string; name: string; admissionYear: number; status: string }) { return withUserContext(user, async (client) => { const current=await client.query(`select specialization_id,exists(select 1 from app.academic_sections where cohort_id=$1) as is_used from app.student_cohorts where id=$1 for update`,[id]);if(!current.rows[0])throw notFoundError();if(current.rows[0].specialization_id!==input.specializationId&&current.rows[0].is_used)throw academicContextLockedError();const result=await client.query(`update app.student_cohorts set specialization_id=$2,code=$3,name=$4,admission_year=$5,status=$6,updated_at=now() where id=$1 returning id`,[id,input.specializationId,input.code,input.name,input.admissionYear,input.status]);if(!result.rows[0])throw notFoundError();await client.query(`select app.write_audit($1,'student_cohort.update','student_cohort',$2,$3::jsonb,null)`,[user.id,id,JSON.stringify(input)]);}); }
  createSection(user: AuthUser, input: { cohortId: string; levelId: string; academicYearId: string; code: string; name: string; status: string }) { return this.insertAudited(user, `insert into app.academic_sections(cohort_id,level_id,academic_year_id,code,name,status) values($1,$2,$3,$4,$5,$6) returning id`, [input.cohortId,input.levelId,input.academicYearId,input.code,input.name,input.status], 'academic_section.create', 'academic_section', input); }
  updateSection(user: AuthUser, id: string, input: { cohortId: string; levelId: string; academicYearId: string; code: string; name: string; status: string }) { return withUserContext(user, async (client) => { const current=await client.query(`select cohort_id,level_id,academic_year_id,(exists(select 1 from app.section_memberships where section_id=$1) or exists(select 1 from app.course_offerings where section_id=$1)) as is_used from app.academic_sections where id=$1 for update`,[id]);if(!current.rows[0])throw notFoundError();const row=current.rows[0];if(row.is_used&&(row.cohort_id!==input.cohortId||row.level_id!==input.levelId||row.academic_year_id!==input.academicYearId))throw academicContextLockedError();const result=await client.query(`update app.academic_sections set cohort_id=$2,level_id=$3,academic_year_id=$4,code=$5,name=$6,status=$7,updated_at=now() where id=$1 returning id`,[id,input.cohortId,input.levelId,input.academicYearId,input.code,input.name,input.status]);if(!result.rows[0])throw notFoundError();await client.query(`select app.write_audit($1,'academic_section.update','academic_section',$2,$3::jsonb,null)`,[user.id,id,JSON.stringify(input)]);}); }

  listSectionStudents(user: AuthUser, sectionId: string) {
    return withUserContext(user, async (client) => {
      const context = await client.query(`select x.id,x.name,x.code,y.name as academic_year_name,c.name as cohort_name,l.name as level_name,s.name as specialization_name
        from app.academic_sections x join app.academic_years y on y.id=x.academic_year_id join app.student_cohorts c on c.id=x.cohort_id
        join app.academic_levels l on l.id=x.level_id join app.specializations s on s.id=l.specialization_id where x.id=$1`, [sectionId]);
      if (!context.rows[0]) throw notFoundError();
      const members = await client.query(`select u.id,u.display_name,u.email::text,u.phone_e164,m.status,m.joined_at,m.status_changed_at,m.change_reason from app.section_memberships m join app.users u on u.id=m.student_user_id where m.section_id=$1 order by u.display_name`, [sectionId]);
      const candidates = await client.query(`select u.id,u.display_name,u.email::text,u.phone_e164,l.name as level_name,s.name as specialization_name from app.users u left join app.academic_levels l on l.id=u.academic_level_id left join app.specializations s on s.id=l.specialization_id where u.role='student' and u.status='active' and not exists(select 1 from app.section_memberships m join app.academic_sections x on x.id=m.section_id where m.student_user_id=u.id and m.status='active' and x.academic_year_id=(select academic_year_id from app.academic_sections where id=$1)) order by u.display_name limit 300`, [sectionId]);
      const row=context.rows[0];
      return { section:{id:row.id,name:row.name,code:row.code,academicYearName:row.academic_year_name,cohortName:row.cohort_name,levelName:row.level_name,specializationName:row.specialization_name},
        members:members.rows.map((item)=>({studentId:item.id,displayName:item.display_name,email:item.email,phone:item.phone_e164,status:item.status,joinedAt:item.joined_at,statusChangedAt:item.status_changed_at,changeReason:item.change_reason})),
        candidates:candidates.rows.map((item)=>({studentId:item.id,displayName:item.display_name,email:item.email,phone:item.phone_e164,levelName:item.level_name,specializationName:item.specialization_name})) };
    });
  }
  addSectionStudent(user: AuthUser, sectionId: string, studentId: string) { return withUserContext(user, async (client) => { await client.query(`update app.section_memberships set status='completed',status_changed_at=now(),change_reason='نقل إلى شعبة أخرى' where student_user_id=$2 and status='active' and academic_year_id=(select academic_year_id from app.academic_sections where id=$1) and section_id<>$1`,[sectionId,studentId]); await client.query(`insert into app.section_memberships(section_id,student_user_id,academic_year_id,assigned_by) values($1,$2,(select academic_year_id from app.academic_sections where id=$1),$3) on conflict(section_id,student_user_id) do update set status='active',assigned_by=$3,status_changed_at=now(),change_reason=null`,[sectionId,studentId,user.id]); await client.query(`select app.write_audit($1,'section.membership.add','academic_section',$2,$3::jsonb,null)`,[user.id,sectionId,JSON.stringify({studentId})]); }); }
  updateSectionStudent(user: AuthUser, sectionId: string, studentId: string, status: string, reason: string | null) { return withUserContext(user, async (client) => { const result=await client.query(`update app.section_memberships set status=$3,status_changed_at=now(),change_reason=$4 where section_id=$1 and student_user_id=$2 returning section_id`,[sectionId,studentId,status,reason]); if(!result.rows[0])throw notFoundError(); await client.query(`select app.write_audit($1,'section.membership.update','academic_section',$2,$3::jsonb,null)`,[user.id,sectionId,JSON.stringify({studentId,status,reason})]); }); }

  createOffering(user: AuthUser, input: { courseId: string; termId: string; sectionId: string; instructorUserId: string; status: string }) { return withUserContext(user, async (client) => { const result=await client.query<{id:string}>(`insert into app.course_offerings(course_id,term_id,section_id,instructor_user_id,status) select $1,$2,$3,u.id,$5 from app.users u join app.academic_terms t on t.id=$2 join app.academic_sections x on x.id=$3 where u.id=$4 and u.role='instructor' and u.status='active' and t.academic_year_id=x.academic_year_id returning id`,[input.courseId,input.termId,input.sectionId,input.instructorUserId,input.status]); if(!result.rows[0])throw integrityError('course_offering_context_match'); await client.query(`select app.write_audit($1,'course_offering.create','course_offering',$2,$3::jsonb,null)`,[user.id,result.rows[0].id,JSON.stringify(input)]); return result.rows[0].id; }); }
  updateOffering(user: AuthUser, id: string, input: { courseId: string; termId: string; sectionId: string; instructorUserId: string; status: string }) { return withUserContext(user, async (client) => { const current=await client.query(`select o.course_id,o.term_id,o.section_id,exists(select 1 from app.learning_activities a where a.offering_id=o.id) as has_activities from app.course_offerings o where o.id=$1 for update`,[id]); if(!current.rows[0])throw notFoundError(); const row=current.rows[0]; if((row.course_id!==input.courseId||row.term_id!==input.termId||row.section_id!==input.sectionId)&&row.has_activities){const error=new Error('Offering context locked') as Error&{code:string};error.code='OFFERING_CONTEXT_LOCKED';throw error;} const result=await client.query(`update app.course_offerings o set course_id=$2,term_id=$3,section_id=$4,instructor_user_id=$5,status=$6,updated_at=now() from app.academic_terms t,app.academic_sections x,app.users u where o.id=$1 and t.id=$3 and x.id=$4 and t.academic_year_id=x.academic_year_id and u.id=$5 and u.role='instructor' and u.status='active' returning o.id`,[id,input.courseId,input.termId,input.sectionId,input.instructorUserId,input.status]); if(!result.rows[0])throw integrityError('course_offering_context_match'); await client.query(`select app.write_audit($1,'course_offering.update','course_offering',$2,$3::jsonb,null)`,[user.id,id,JSON.stringify(input)]); }); }

  private insertAudited(user:AuthUser,sql:string,values:unknown[],action:string,type:string,metadata:unknown){return withUserContext(user,async client=>{const result=await client.query<{id:string}>(sql,values);const id=result.rows[0]!.id;await client.query(`select app.write_audit($1,$2,$3,$4,$5::jsonb,null)`,[user.id,action,type,id,JSON.stringify(metadata)]);return id;});}
  private updateAudited(user:AuthUser,sql:string,values:unknown[],action:string,type:string,id:string,metadata:unknown){return withUserContext(user,async client=>{const result=await client.query(sql,values);if(!result.rows[0])throw notFoundError();await client.query(`select app.write_audit($1,$2,$3,$4,$5::jsonb,null)`,[user.id,action,type,id,JSON.stringify(metadata)]);});}
}

function mapYear(row:Record<string,unknown>){return{id:row.id,code:row.code,name:row.name,startsOn:row.starts_on,endsOn:row.ends_on,status:row.status};}
function mapTerm(row:Record<string,unknown>){return{id:row.id,academicYearId:row.academic_year_id,academicYearName:row.academic_year_name,academicYearCode:row.academic_year_code,termNumber:Number(row.term_number),code:row.code,name:row.name,startsOn:row.starts_on,endsOn:row.ends_on,status:row.status,isSystem:row.is_system};}
function mapOffering(row:Record<string,unknown>){return{id:row.id,courseId:row.course_id,courseCode:row.course_code,courseTitle:row.course_title,termId:row.term_id,termCode:row.term_code,termName:row.term_name,academicYearId:row.academic_year_id,academicYearName:row.academic_year_name,sectionId:row.section_id,sectionCode:row.section_code,sectionName:row.section_name,levelId:row.level_id,levelName:row.level_name,specializationName:row.specialization_name,instructorUserId:row.instructor_user_id,instructorName:row.instructor_name,status:row.status,studentCount:Number(row.student_count),createdAt:row.created_at,updatedAt:row.updated_at};}
function notFoundError(){const error=new Error('Not found') as Error&{code:string};error.code='P0002';return error;}
function integrityError(constraint:string){const error=new Error('Invalid context') as Error&{code:string;constraint:string};error.code='23514';error.constraint=constraint;return error;}
function academicContextLockedError(){const error=new Error('Academic context locked') as Error&{code:string};error.code='ACADEMIC_CONTEXT_LOCKED';return error;}
