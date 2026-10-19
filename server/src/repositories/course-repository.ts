import type { PoolClient } from 'pg';
import type { AuthUser } from '../domain/auth.js';
import { withUserContext } from '../db/pool.js';

type CourseRow = { id: string; offering_id: string; term_code: string; term_name: string; section_code: string; offering_status: string; code: string; title: string; owner_user_id: string; owner_name: string | null; level_id: string; level_name: string; level_number: number; specialization_id: string; specialization_name: string; department_id: string; department_name: string; is_active: boolean; created_at: Date; updated_at: Date; member_count: string; assignment_count: string; completed_count: string };
type AssignmentRow = { id: string; offering_id: string; course_title: string; term_name: string; section_code: string; title: string; description: string; due_at: Date | null; max_score: string; published_at: Date | null; created_by: string; created_at: Date; updated_at: Date; language: 'python' | 'javascript'; starter_code: string; submission_count: string; latest_submission_id: string | null; latest_status: string | null; latest_score: string | null; latest_submitted_at: Date | null; attempt_count: string };
type EnrollmentStatus = 'active' | 'withdrawn' | 'completed' | 'suspended';

export class CourseRepository {
  listCatalog(user: AuthUser) {
    return withUserContext(user, async (client) => {
      const result=await client.query(`select c.id,c.code,c.title,c.is_active,c.created_at,c.updated_at,
        count(o.id)::int as offering_count from app.courses c left join app.course_offerings o on o.course_id=c.id
        group by c.id order by c.code`);
      return result.rows.map((row)=>({id:row.id,code:row.code,title:row.title,isActive:row.is_active,offeringCount:Number(row.offering_count),createdAt:row.created_at,updatedAt:row.updated_at}));
    });
  }

  list(user: AuthUser) {
    return withUserContext(user, async (client) => {
      const result = await client.query<CourseRow>(
        `select c.id,o.id as offering_id,t.code as term_code,t.name as term_name,x.code as section_code,o.status as offering_status,c.code,c.title,
                o.instructor_user_id as owner_user_id,owner.display_name as owner_name,
                l.id as level_id, l.name as level_name, l.level_number,
                s.id as specialization_id, s.name as specialization_name,
                d.id as department_id, d.name as department_name,
                (c.is_active and o.status='active') as is_active,c.created_at,greatest(c.updated_at,o.updated_at) as updated_at,
                (select count(*) from app.section_memberships cm join app.users member on member.id=cm.student_user_id
                  where cm.section_id=o.section_id and cm.status='active' and member.role='student' and member.status='active') as member_count,
                (select count(*) from app.learning_activities la where la.offering_id=o.id and la.activity_type='assignment') as assignment_count,
                (select count(distinct s.assignment_id)
                   from app.submissions s join app.assignments a on a.id=s.assignment_id
                   join app.learning_activities la on la.id=a.activity_id
                  where la.offering_id=o.id and s.student_user_id=app.current_user_id()) as completed_count
         from app.course_offerings o join app.courses c on c.id=o.course_id
         join app.academic_terms t on t.id=o.term_id
         left join app.users owner on owner.id=o.instructor_user_id
         join app.academic_sections x on x.id=o.section_id
         join app.academic_levels l on l.id = x.level_id
         join app.specializations s on s.id = l.specialization_id
         join app.academic_departments d on d.id = s.department_id
         where app.current_user_role()='admin' or (c.is_active and o.status='active')
         order by c.code,t.starts_on desc nulls last,x.code`,
      );
      return result.rows.map(mapCourse);
    });
  }

  create(user: AuthUser, input: { code: string; title: string }) {
    return withUserContext(user, async (client) => {
      const result=await client.query(`insert into app.courses(code,title) values($1,$2) returning id,code,title,is_active,created_at,updated_at`,[input.code,input.title]);
      const course=result.rows[0];
      await client.query(`select app.write_audit($1,'course.create','course',$2,$3::jsonb,null)`,[user.id,course.id,JSON.stringify(input)]);
      return { id:course.id,code:course.code,title:course.title,isActive:course.is_active,createdAt:course.created_at,updatedAt:course.updated_at };
    });
  }

  update(user: AuthUser, courseId: string, input: { code: string; title: string }) {
    return withUserContext(user, async (client) => {
      const result=await client.query(`update app.courses set code=$2,title=$3,updated_at=now() where id=$1 returning id`,[courseId,input.code,input.title]);
      if(!result.rows[0]){const error=new Error('Course not found') as Error&{code:string};error.code='P0002';throw error;}
      await client.query(`select app.write_audit($1,'course.update','course',$2,$3::jsonb,null)`,[user.id,courseId,JSON.stringify(input)]);
    });
  }

  setStatus(user: AuthUser, courseId: string, isActive: boolean) {
    return withUserContext(user, async (client) => {
      await client.query('select app.admin_set_course_status($1, $2, $3)', [user.id, courseId, isActive]);
    });
  }

  listEnrollments(user: AuthUser, offeringId: string) {
    return withUserContext(user, async (client) => {
      const courseResult = await client.query(
        `select o.id,c.id as course_id,c.code,c.title,x.level_id,l.name as level_name,
                s.name as specialization_name,d.name as department_name,t.name as term_name,x.code as section_code
         from app.course_offerings o join app.courses c on c.id=o.course_id
         join app.academic_terms t on t.id=o.term_id
         join app.academic_sections x on x.id=o.section_id
         join app.academic_levels l on l.id = x.level_id
         join app.specializations s on s.id = l.specialization_id
         join app.academic_departments d on d.id = s.department_id
         where o.id=$1`, [offeringId],
      );
      if (!courseResult.rows[0]) {
        const error = new Error('Course roster access denied') as Error & { code: string };
        error.code = '42501';
        throw error;
      }

      const enrolledResult = await client.query(
        `select u.id, u.display_name,
                case when app.current_user_role() = 'admin' then u.email::text else null end as email,
                case when app.current_user_role() = 'admin' then u.phone_e164 else null end as phone,
                l.name as level_name, s.name as specialization_name, d.name as department_name,
                cm.status,cm.joined_at,cm.status_changed_at,cm.change_reason
         from app.course_offerings ox join app.section_memberships cm on cm.section_id=ox.section_id
         join app.users u on u.id = cm.student_user_id
         left join app.academic_levels l on l.id = u.academic_level_id
         left join app.specializations s on s.id = l.specialization_id
         left join app.academic_departments d on d.id = s.department_id
         where ox.id=$1 and (app.current_user_role() = 'admin' or cm.status = 'active')
         order by (cm.status='active') desc,u.display_name`, [offeringId],
      );

      const candidateResult = { rows: [] as Array<Record<string, unknown>> };

      const enrollments = enrolledResult.rows.map((row) => ({
        studentId: row.id, displayName: row.display_name, email: row.email, phone: row.phone,
        levelName: row.level_name, specializationName: row.specialization_name, departmentName: row.department_name,
        status: row.status as EnrollmentStatus, enrollmentType: 'section',
        enrolledAt: row.joined_at, statusChangedAt: row.status_changed_at,
        removedAt: null, removalReason: row.change_reason,
      }));
      const candidates = candidateResult.rows.map((row) => ({
        studentId: row.id, displayName: row.display_name, email: row.email, phone: row.phone,
        levelName: row.level_name, specializationName: row.specialization_name, departmentName: row.department_name,
        isEligible: false, previousStatus: null,
      }));
      const summary = enrollments.reduce((counts, enrollment) => {
        counts[enrollment.status] += 1;
        return counts;
      }, { active: 0, withdrawn: 0, completed: 0, suspended: 0 });
      const course = courseResult.rows[0];
      return {
        course: { id: course.course_id, offeringId: course.id, code: course.code, title: course.title, levelId: course.level_id,
          termName: course.term_name, sectionCode: course.section_code,
          levelName: course.level_name, specializationName: course.specialization_name, departmentName: course.department_name },
        summary, enrollments, candidates,
      };
    });
  }

  listAssignments(user: AuthUser, offeringId?: string) {
    return withUserContext(user, async (client) => {
      const values: unknown[] = offeringId ? [offeringId] : [];
      const filter = offeringId ? 'where la.offering_id=$1' : '';
      const result = await client.query<AssignmentRow>(
        `select a.id,la.offering_id,c.title as course_title,t.name as term_name,x.code as section_code,a.title,a.description,
                a.due_at, a.max_score, a.published_at, a.created_by, a.created_at,
                a.updated_at, a.language, a.starter_code,
                (select count(*) from app.submissions sx where sx.assignment_id = a.id) as submission_count,
                latest.id as latest_submission_id, latest.status as latest_status,
                latest.score as latest_score, latest.submitted_at as latest_submitted_at,
                (select count(*) from app.submissions sa
                  where sa.assignment_id = a.id and sa.student_user_id = app.current_user_id()) as attempt_count
         from app.assignments a join app.learning_activities la on la.id=a.activity_id
         join app.course_offerings o on o.id=la.offering_id join app.courses c on c.id=o.course_id
         join app.academic_sections x on x.id=o.section_id
         join app.academic_terms t on t.id=o.term_id
         left join lateral (
           select s.id, s.status, s.score, s.submitted_at from app.submissions s
           where s.assignment_id = a.id and s.student_user_id = app.current_user_id()
           order by s.attempt_number desc limit 1
         ) latest on true ${filter}
         order by a.due_at nulls last, a.created_at desc`, values,
      );
      return result.rows.map(mapAssignment);
    });
  }

  createAssignment(user: AuthUser, offeringId: string, input: { title: string; description: string; dueAt: Date | null; maxScore: number; publish: boolean; language: 'python' | 'javascript'; starterCode: string }) {
    return withUserContext(user, async (client: PoolClient) => {
      const activity = await client.query<{ id: string }>(
        `insert into app.learning_activities(
           offering_id,activity_type,title,description,status,points,available_from,due_at,source_type,created_by
         ) values (
           $1,'assignment',$2,$3,case when $4 then 'published' else 'draft' end,
           $5,case when $4 then now() else null end,$6,'assignment',$7
         ) returning id`,
        [offeringId, input.title, input.description, input.publish, input.maxScore, input.dueAt, user.id],
      );
      const result = await client.query<AssignmentRow>(
        `insert into app.assignments(title,description,due_at,max_score,published_at,created_by,language,starter_code,activity_id)
         values ($1,$2,$3,$4,case when $5 then now() else null end,$6,$7,$8,$9)
         returning id,$10::uuid as offering_id,(select c.title from app.course_offerings o join app.courses c on c.id=o.course_id where o.id=$10) as course_title,
                   (select t.name from app.course_offerings o join app.academic_terms t on t.id=o.term_id where o.id=$10) as term_name,
                   (select x.code from app.course_offerings o join app.academic_sections x on x.id=o.section_id where o.id=$10) as section_code,
                   title, description, due_at, max_score, published_at, created_by, created_at,
                   updated_at, language, starter_code, 0::bigint as submission_count,
                   null::uuid as latest_submission_id, null::text as latest_status,
                   null::numeric as latest_score, null::timestamptz as latest_submitted_at,
                   0::bigint as attempt_count`,
        [input.title,input.description,input.dueAt,input.maxScore,input.publish,user.id,input.language,input.starterCode,activity.rows[0]!.id,offeringId],
      );
      await client.query('update app.learning_activities set source_id=$2 where id=$1', [activity.rows[0]!.id, result.rows[0]!.id]);
      return mapAssignment(result.rows[0]!);
    });
  }

  submit(user: AuthUser, assignmentId: string, sourceCode: string) {
    return withUserContext(user, async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${assignmentId}:${user.id}`]);
      const result = await client.query(
        `insert into app.submissions(assignment_id, student_user_id, attempt_number, source_code)
         select $1, $2, coalesce(max(attempt_number), 0) + 1, $3
         from app.submissions where assignment_id = $1 and student_user_id = $2
         returning id, assignment_id, attempt_number, status, score, submitted_at`,
        [assignmentId, user.id, sourceCode],
      );
      return mapSubmission(result.rows[0]);
    });
  }

  listSubmissions(user: AuthUser, assignmentId: string) {
    return withUserContext(user, async (client) => {
      const result = await client.query(
        `select s.id, s.assignment_id, s.student_user_id, u.display_name as student_name,
                s.attempt_number, s.status, s.score, s.feedback, s.submitted_at, s.graded_at
         from app.submissions s join app.users u on u.id = s.student_user_id
         where s.assignment_id = $1 order by s.submitted_at desc`, [assignmentId],
      );
      return result.rows.map((row) => ({ id: row.id, assignmentId: row.assignment_id, studentUserId: row.student_user_id, studentName: row.student_name, attemptNumber: row.attempt_number, status: row.status, score: row.score == null ? null : Number(row.score), feedback: row.feedback, submittedAt: row.submitted_at, gradedAt: row.graded_at }));
    });
  }

  listPeople(user: AuthUser) {
    return withUserContext(user, async (client) => {
      const result = await client.query(
        `select u.id, u.email, u.phone_e164, u.display_name, u.role, u.status, u.last_login_at, u.created_at,
                l.id as level_id, l.name as level_name, s.id as specialization_id, s.name as specialization_name,
                d.id as department_id, d.name as department_name,
                count(distinct o.id) filter (where cm.status='active' and o.status='active') as course_count
         from app.users u
         left join app.section_memberships cm on cm.student_user_id=u.id
         left join app.course_offerings o on o.section_id=cm.section_id
         left join app.academic_levels l on l.id = u.academic_level_id
         left join app.specializations s on s.id = l.specialization_id
         left join app.academic_departments d on d.id = s.department_id
         ${user.role === 'instructor' ? "where u.role = 'student'" : ''}
         group by u.id, l.id, s.id, d.id order by u.created_at desc limit 200`,
      );
      return result.rows.map((row) => ({ id: row.id, email: row.email, phone: row.phone_e164, displayName: row.display_name, role: row.role, status: row.status, lastLoginAt: row.last_login_at, createdAt: row.created_at, courseCount: Number(row.course_count), levelId: row.level_id, levelName: row.level_name, specializationId: row.specialization_id, specializationName: row.specialization_name, departmentId: row.department_id, departmentName: row.department_name }));
    });
  }
}

function mapCourse(row: CourseRow) {
  const assignmentCount = Number(row.assignment_count);
  const completedCount = Number(row.completed_count);
  return { id: row.id, offeringId: row.offering_id, termCode: row.term_code, termName: row.term_name, sectionCode: row.section_code, offeringStatus: row.offering_status, code: row.code, title: row.title, ownerUserId: row.owner_user_id, ownerName: row.owner_name, levelId: row.level_id, levelName: row.level_name, levelNumber: row.level_number, specializationId: row.specialization_id, specializationName: row.specialization_name, departmentId: row.department_id, departmentName: row.department_name, isActive: row.is_active, memberCount: Number(row.member_count), assignmentCount, completedCount, progress: assignmentCount ? Math.round((completedCount / assignmentCount) * 100) : 0, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapAssignment(row: AssignmentRow) {
  return { id: row.id, offeringId: row.offering_id, courseTitle: row.course_title, termName: row.term_name, sectionCode: row.section_code, title: row.title, description: row.description, dueAt: row.due_at, maxScore: Number(row.max_score), publishedAt: row.published_at, createdBy: row.created_by, language: row.language, starterCode: row.starter_code, submissionCount: Number(row.submission_count), latestSubmissionId: row.latest_submission_id, latestStatus: row.latest_status, latestScore: row.latest_score == null ? null : Number(row.latest_score), latestSubmittedAt: row.latest_submitted_at, attemptCount: Number(row.attempt_count), createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapSubmission(row: Record<string, unknown>) {
  return { id: row.id, assignmentId: row.assignment_id, attemptNumber: row.attempt_number, status: row.status, score: row.score == null ? null : Number(row.score), submittedAt: row.submitted_at };
}
