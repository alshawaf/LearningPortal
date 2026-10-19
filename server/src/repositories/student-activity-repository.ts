import type { AuthUser } from '../domain/auth.js';
import { withUserContext } from '../db/pool.js';

export type StudentActivityStatus = 'not_started' | 'active' | 'inactive' | 'struggling' | 'completed';
type ActivityRow = Record<string, unknown> & { student_id: string; display_name: string; last_login_at: Date | null;
  level_name: string | null; specialization_name: string | null; department_name: string | null;
  course_count: string; exercise_count: string; completed_count: string; attempt_count: string;
  failed_attempt_count: string; points: string; first_pass_count: string; last_attempt_at: Date | null };

const accessibleOfferings = `select o.id,o.course_id,c.code,c.title,t.name as term_name,x.code as section_code
  from app.course_offerings o join app.courses c on c.id=o.course_id join app.academic_terms t on t.id=o.term_id
  join app.academic_sections x on x.id=o.section_id
  where o.status='active' and c.is_active
    and (app.current_user_role()='admin' or o.instructor_user_id=app.current_user_id())
    and ($2::uuid is null or o.id=$2)`;

export class StudentActivityRepository {
  list(user: AuthUser, offeringId: string | null) {
    return withUserContext(user, async (client) => {
      const listingAccess = accessibleOfferings.replaceAll('$2', '$1').replace(
        `(app.current_user_role()='admin' or o.instructor_user_id=app.current_user_id())`,
        `($2::uuid is null or o.instructor_user_id=$2)`,
      );
      const result = await client.query<ActivityRow>(
        `with accessible_offerings as (${listingAccess}), roster as (
           select distinct m.student_user_id as student_id from accessible_offerings ao
           join app.course_offerings o on o.id=ao.id join app.section_memberships m on m.section_id=o.section_id and m.status='active'
         )
         select r.student_id,u.display_name,u.last_login_at,l.name as level_name,s.name as specialization_name,d.name as department_name,
           (select count(distinct ao.id) from accessible_offerings ao join app.course_offerings o on o.id=ao.id
             join app.section_memberships m on m.section_id=o.section_id where m.student_user_id=r.student_id and m.status='active')::int as course_count,
           (select count(*) from app.practice_exercises e join app.learning_activities la on la.id=e.activity_id
             join accessible_offerings ao on ao.id=la.offering_id where e.status='published')::int as exercise_count,
           (select count(*) from app.practice_completions pc join app.practice_exercises e on e.id=pc.exercise_id
             join app.learning_activities la on la.id=e.activity_id join accessible_offerings ao on ao.id=la.offering_id
             where pc.student_user_id=r.student_id and e.status='published')::int as completed_count,
           (select count(*) from app.practice_attempts pa join app.practice_exercises e on e.id=pa.exercise_id
             join app.learning_activities la on la.id=e.activity_id join accessible_offerings ao on ao.id=la.offering_id
             where pa.student_user_id=r.student_id and e.status='published')::int as attempt_count,
           (select count(*) from app.practice_attempts pa join app.practice_exercises e on e.id=pa.exercise_id
             join app.learning_activities la on la.id=e.activity_id join accessible_offerings ao on ao.id=la.offering_id
             where pa.student_user_id=r.student_id and e.status='published' and pa.status in ('failed','error'))::int as failed_attempt_count,
           coalesce((select sum(pc.points_awarded) from app.practice_completions pc join app.practice_exercises e on e.id=pc.exercise_id
             join app.learning_activities la on la.id=e.activity_id join accessible_offerings ao on ao.id=la.offering_id
             where pc.student_user_id=r.student_id and e.status='published'),0)::int as points,
           (select count(*) from app.practice_completions pc join app.practice_exercises e on e.id=pc.exercise_id
             join app.learning_activities la on la.id=e.activity_id join accessible_offerings ao on ao.id=la.offering_id
             join app.practice_attempts pa on pa.id=pc.first_passing_attempt_id where pc.student_user_id=r.student_id and e.status='published' and pa.attempt_number=1)::int as first_pass_count,
           (select max(pa.submitted_at) from app.practice_attempts pa join app.practice_exercises e on e.id=pa.exercise_id
             join app.learning_activities la on la.id=e.activity_id join accessible_offerings ao on ao.id=la.offering_id
             where pa.student_user_id=r.student_id and e.status='published') as last_attempt_at
         from roster r join app.users u on u.id=r.student_id left join app.academic_levels l on l.id=u.academic_level_id
         left join app.specializations s on s.id=l.specialization_id left join app.academic_departments d on d.id=s.department_id
         where u.role='student' and u.status='active'
         order by u.last_login_at desc nulls last,u.display_name limit 500`, [offeringId, user.role === 'admin' ? null : user.id],
      );
      const students = result.rows.map(mapActivity);
      return { summary: summarize(students), students };
    });
  }

  detail(user: AuthUser, studentId: string, offeringId: string | null) {
    return withUserContext(user, async (client) => {
      const params = [studentId, offeringId];
      const studentResult = await client.query(
        `with accessible_offerings as (${accessibleOfferings})
         select u.id,u.display_name,u.last_login_at,l.name as level_name,s.name as specialization_name,d.name as department_name
         from app.users u left join app.academic_levels l on l.id=u.academic_level_id
         left join app.specializations s on s.id=l.specialization_id left join app.academic_departments d on d.id=s.department_id
         where u.id=$1 and u.role='student' and exists(select 1 from accessible_offerings ao
           join app.course_offerings o on o.id=ao.id join app.section_memberships m on m.section_id=o.section_id
           where m.student_user_id=u.id and m.status='active')`, params,
      );
      if (!studentResult.rows[0]) throw notFoundError();
      const coursesResult = await client.query(
        `with accessible_offerings as (${accessibleOfferings}), exercise_totals as (
           select la.offering_id,count(*)::int as exercise_count from app.practice_exercises e join app.learning_activities la on la.id=e.activity_id
           where e.status='published' group by la.offering_id
         ), attempt_stats as (
           select la.offering_id,count(*)::int as attempt_count,count(*) filter(where pa.status in ('failed','error'))::int as failed_attempt_count,
             max(pa.submitted_at) as last_attempt_at from app.practice_attempts pa join app.practice_exercises e on e.id=pa.exercise_id
             join app.learning_activities la on la.id=e.activity_id where pa.student_user_id=$1 and e.status='published' group by la.offering_id
         ), completion_stats as (
           select la.offering_id,count(*)::int as completed_count,coalesce(sum(pc.points_awarded),0)::int as points,
             count(*) filter(where pa.attempt_number=1)::int as first_pass_count from app.practice_completions pc
             join app.practice_exercises e on e.id=pc.exercise_id and e.status='published' join app.learning_activities la on la.id=e.activity_id
             join app.practice_attempts pa on pa.id=pc.first_passing_attempt_id where pc.student_user_id=$1 group by la.offering_id
         ) select ao.id,ao.code,ao.title,ao.term_name,ao.section_code,coalesce(et.exercise_count,0)::int as exercise_count,
             coalesce(cs.completed_count,0)::int as completed_count,coalesce(ast.attempt_count,0)::int as attempt_count,
             coalesce(ast.failed_attempt_count,0)::int as failed_attempt_count,coalesce(cs.points,0)::int as points,
             coalesce(cs.first_pass_count,0)::int as first_pass_count,ast.last_attempt_at
         from accessible_offerings ao join app.course_offerings o on o.id=ao.id
         join app.section_memberships m on m.section_id=o.section_id
         left join exercise_totals et on et.offering_id=ao.id left join attempt_stats ast on ast.offering_id=ao.id
         left join completion_stats cs on cs.offering_id=ao.id where m.student_user_id=$1
           and m.status='active' order by ao.code`, params,
      );
      const exercisesResult = await client.query(
        `with accessible_offerings as (${accessibleOfferings}), attempt_stats as (
           select exercise_id,count(*)::int as attempt_count,count(*) filter(where status in ('failed','error'))::int as failed_attempt_count,
             max(passed_tests)::int as best_passed_tests,max(total_tests)::int as total_tests,max(submitted_at) as last_attempt_at
           from app.practice_attempts where student_user_id=$1 group by exercise_id
         ) select e.id,e.title,la.offering_id,c.code as course_code,c.title as course_title,ao.term_name,ao.section_code,e.points,
             coalesce(ast.attempt_count,0)::int as attempt_count,coalesce(ast.failed_attempt_count,0)::int as failed_attempt_count,
             coalesce(ast.best_passed_tests,0)::int as best_passed_tests,coalesce(ast.total_tests,0)::int as total_tests,
             ast.last_attempt_at,pc.completed_at,coalesce(pc.points_awarded,0)::int as points_awarded
         from app.practice_exercises e join app.learning_activities la on la.id=e.activity_id
         join accessible_offerings ao on ao.id=la.offering_id join app.courses c on c.id=ao.course_id
         join app.course_offerings o on o.id=ao.id join app.section_memberships m on m.section_id=o.section_id and m.student_user_id=$1 and m.status='active'
         left join attempt_stats ast on ast.exercise_id=e.id left join app.practice_completions pc on pc.exercise_id=e.id and pc.student_user_id=$1
         where e.status='published' order by c.code,e.sort_order,e.created_at`, params,
      );
      const recentAttemptsResult = await client.query(
        `with accessible_offerings as (${accessibleOfferings})
         select pa.id,pa.exercise_id,e.title as exercise_title,c.code as course_code,ao.term_name,ao.section_code,pa.attempt_number,pa.status,
           pa.passed_tests,pa.total_tests,pa.runtime_ms,pa.submitted_at
         from app.practice_attempts pa join app.practice_exercises e on e.id=pa.exercise_id
         join app.learning_activities la on la.id=e.activity_id join accessible_offerings ao on ao.id=la.offering_id
         join app.courses c on c.id=ao.course_id where pa.student_user_id=$1 order by pa.submitted_at desc limit 20`, params,
      );
      const courses = coursesResult.rows.map(mapCourseActivity);
      const totals = courses.reduce((acc, course) => ({ exerciseCount:acc.exerciseCount+course.exerciseCount,
        completedCount:acc.completedCount+course.completedCount,attemptCount:acc.attemptCount+course.attemptCount,
        failedAttemptCount:acc.failedAttemptCount+course.failedAttemptCount,points:acc.points+course.points,
        firstPassCount:acc.firstPassCount+course.firstPassCount }),
      { exerciseCount:0,completedCount:0,attemptCount:0,failedAttemptCount:0,points:0,firstPassCount:0 });
      const student=studentResult.rows[0];
      return { student:{ id:student.id,displayName:student.display_name,lastLoginAt:student.last_login_at,levelName:student.level_name,
        specializationName:student.specialization_name,departmentName:student.department_name },
        summary:{...totals,completionRate:percent(totals.completedCount,totals.exerciseCount),firstPassRate:percent(totals.firstPassCount,totals.completedCount)},courses,
        exercises:exercisesResult.rows.map((row)=>({id:row.id,title:row.title,offeringId:row.offering_id,courseCode:row.course_code,
          courseTitle:row.course_title,termName:row.term_name,sectionCode:row.section_code,points:Number(row.points),attemptCount:Number(row.attempt_count),failedAttemptCount:Number(row.failed_attempt_count),
          bestPassedTests:Number(row.best_passed_tests),totalTests:Number(row.total_tests),lastAttemptAt:row.last_attempt_at,completedAt:row.completed_at,
          pointsAwarded:Number(row.points_awarded),status:row.completed_at?'completed':Number(row.attempt_count)?'in_progress':'not_started'})),
        recentAttempts:recentAttemptsResult.rows.map((row)=>({id:row.id,exerciseId:row.exercise_id,exerciseTitle:row.exercise_title,
          courseCode:row.course_code,termName:row.term_name,sectionCode:row.section_code,attemptNumber:Number(row.attempt_number),status:row.status,passedTests:Number(row.passed_tests),
          totalTests:Number(row.total_tests),runtimeMs:row.runtime_ms,submittedAt:row.submitted_at})) };
    });
  }
}

function mapActivity(row:ActivityRow){const exerciseCount=Number(row.exercise_count),completedCount=Number(row.completed_count),attemptCount=Number(row.attempt_count);
  const failedAttemptCount=Number(row.failed_attempt_count),firstPassCount=Number(row.first_pass_count),lastActivityAt=latestDate(row.last_login_at,row.last_attempt_at);
  return {studentId:row.student_id,displayName:row.display_name,levelName:row.level_name,specializationName:row.specialization_name,
    departmentName:row.department_name,courseCount:Number(row.course_count),exerciseCount,completedCount,attemptCount,failedAttemptCount,
    points:Number(row.points),firstPassCount,completionRate:percent(completedCount,exerciseCount),firstPassRate:percent(firstPassCount,completedCount),
    lastLoginAt:row.last_login_at,lastAttemptAt:row.last_attempt_at,lastActivityAt,status:activityStatus({exerciseCount,completedCount,attemptCount,failedAttemptCount,lastActivityAt})};}
function mapCourseActivity(row:Record<string,unknown>){const exerciseCount=Number(row.exercise_count),completedCount=Number(row.completed_count);return {id:row.id,code:row.code,title:row.title,termName:row.term_name,sectionCode:row.section_code,exerciseCount,completedCount,attemptCount:Number(row.attempt_count),failedAttemptCount:Number(row.failed_attempt_count),points:Number(row.points),firstPassCount:Number(row.first_pass_count),lastAttemptAt:row.last_attempt_at,completionRate:percent(completedCount,exerciseCount)};}
function activityStatus(input:{exerciseCount:number;completedCount:number;attemptCount:number;failedAttemptCount:number;lastActivityAt:Date|null}):StudentActivityStatus{if(input.exerciseCount>0&&input.completedCount>=input.exerciseCount)return'completed';if(input.failedAttemptCount>=3)return'struggling';if(input.attemptCount===0)return'not_started';if(!input.lastActivityAt||Date.now()-input.lastActivityAt.getTime()>7*86_400_000)return'inactive';return'active';}
function latestDate(left:Date|null,right:Date|null){if(!left)return right;if(!right)return left;return left>right?left:right;}
function percent(value:number,total:number){return total?Math.round(value/total*100):0;}
function summarize(students:ReturnType<typeof mapActivity>[]){return students.reduce((summary,student)=>{summary.studentCount+=1;if(student.lastActivityAt&&Date.now()-student.lastActivityAt.getTime()<=7*86_400_000)summary.activeCount+=1;if(student.status==='completed')summary.completedCount+=1;if(student.status==='not_started')summary.notStartedCount+=1;if(student.status==='struggling'||student.status==='inactive')summary.needsAttentionCount+=1;summary.exerciseCount+=student.exerciseCount;summary.practiceCompletionCount+=student.completedCount;return summary;},{studentCount:0,activeCount:0,completedCount:0,notStartedCount:0,needsAttentionCount:0,exerciseCount:0,practiceCompletionCount:0});}
function notFoundError(){const error=new Error('Student activity not found') as Error&{code:string};error.code='P0002';return error;}
