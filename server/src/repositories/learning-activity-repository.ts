import type { AuthUser } from '../domain/auth.js';
import { withUserContext } from '../db/pool.js';

export class LearningActivityRepository {
  list(user: AuthUser, offeringId?: string) {
    return withUserContext(user, async (client) => {
      const result = await client.query(
        `select a.id,a.offering_id,a.activity_type,a.title,a.description,a.status,a.points,a.available_from,a.due_at,
                a.duration_minutes,a.source_type,a.source_id,a.metadata,a.created_at,a.updated_at,
                c.id as course_id,c.code as course_code,c.title as course_title,t.id as term_id,t.code as term_code,t.name as term_name
         from app.learning_activities a join app.course_offerings o on o.id=a.offering_id
         join app.courses c on c.id=o.course_id join app.academic_terms t on t.id=o.term_id
         where ($1::uuid is null or a.offering_id=$1) order by a.created_at desc limit 500`,
        [offeringId ?? null],
      );
      return result.rows.map((row) => ({ id: row.id, offeringId: row.offering_id, activityType: row.activity_type,
        title: row.title, description: row.description, status: row.status, points: Number(row.points), availableFrom: row.available_from,
        dueAt: row.due_at, durationMinutes: row.duration_minutes, sourceType: row.source_type, sourceId: row.source_id,
        metadata: row.metadata, courseId: row.course_id, courseCode: row.course_code, courseTitle: row.course_title,
        termId: row.term_id, termCode: row.term_code, termName: row.term_name, createdAt: row.created_at, updatedAt: row.updated_at }));
    });
  }
}
