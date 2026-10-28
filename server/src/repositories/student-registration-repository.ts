import type { AuthUser } from '../domain/auth.js';
import { pool, withUserContext } from '../db/pool.js';

export type RegistrationStatus = 'pending' | 'changes_requested' | 'approved' | 'rejected' | 'cancelled' | 'expired';

type OptionRow = {
  department_id: string; department_code: string; department_name: string;
  specialization_id: string; specialization_code: string; specialization_name: string;
  level_id: string; level_number: number; level_name: string;
};

type RegistrationRow = {
  request_id?: string; id?: string; email: string; phone_e164: string; display_name: string;
  student_number: string | null; status: RegistrationStatus; decision_reason: string | null;
  department_id?: string; department_name: string; specialization_id?: string; specialization_name: string;
  level_id?: string; level_name: string; academic_level_id?: string;
  created_at: Date; updated_at: Date; reviewed_at?: Date | null; reviewed_by_name?: string | null;
};

export class StudentRegistrationRepository {
  async options() {
    const result = await pool.query<OptionRow>('select * from app.public_registration_options()');
    const departments = new Map<string, {
      id: string; code: string; name: string;
      specializations: Map<string, { id: string; code: string; name: string; levels: Array<{ id: string; number: number; name: string }> }>;
    }>();
    for (const row of result.rows) {
      let department = departments.get(row.department_id);
      if (!department) {
        department = { id: row.department_id, code: row.department_code, name: row.department_name, specializations: new Map() };
        departments.set(row.department_id, department);
      }
      let specialization = department.specializations.get(row.specialization_id);
      if (!specialization) {
        specialization = { id: row.specialization_id, code: row.specialization_code, name: row.specialization_name, levels: [] };
        department.specializations.set(row.specialization_id, specialization);
      }
      specialization.levels.push({ id: row.level_id, number: row.level_number, name: row.level_name });
    }
    return [...departments.values()].map((department) => ({
      id: department.id, code: department.code, name: department.name,
      specializations: [...department.specializations.values()],
    }));
  }

  async create(input: {
    email: string; phone: string; displayName: string; studentNumber: string | null;
    academicLevelId: string; passwordHash: string; trackingTokenHash: Buffer; ipHash: Buffer | null;
  }): Promise<string> {
    const result = await pool.query<{ create_student_registration: string }>(
      'select app.create_student_registration($1, $2, $3, $4, $5, $6, $7, $8)',
      [input.email, input.phone, input.displayName, input.studentNumber, input.academicLevelId,
        input.passwordHash, input.trackingTokenHash, input.ipHash],
    );
    return result.rows[0]!.create_student_registration;
  }

  async status(trackingTokenHash: Buffer) {
    const result = await pool.query<RegistrationRow>('select * from app.student_registration_status($1)', [trackingTokenHash]);
    const row = result.rows[0];
    return row ? mapStatus(row) : null;
  }

  async list(actor: AuthUser) {
    return withUserContext(actor, async (client) => {
      const result = await client.query<RegistrationRow>(
        `select r.id, r.email, r.phone_e164, r.display_name, r.student_number, r.status,
                r.decision_reason, r.academic_level_id, r.created_at, r.updated_at,
                r.reviewed_at, reviewer.display_name as reviewed_by_name,
                d.id as department_id, d.name as department_name,
                s.id as specialization_id, s.name as specialization_name,
                l.id as level_id, l.name as level_name
         from app.student_registration_requests r
         join app.academic_levels l on l.id = r.academic_level_id
         join app.specializations s on s.id = l.specialization_id
         join app.academic_departments d on d.id = s.department_id
         left join app.users reviewer on reviewer.id = r.reviewed_by
         order by case r.status when 'pending' then 0 when 'changes_requested' then 1 else 2 end,
                  r.created_at desc
         limit 300`,
      );
      return result.rows.map(mapAdminRow);
    });
  }

  async listEligibleSections(actor: AuthUser) {
    return withUserContext(actor, async (client) => {
      const result = await client.query(
        `select x.id,x.level_id,x.name,x.code,y.name as academic_year_name,c.name as cohort_name
         from app.academic_sections x join app.academic_years y on y.id=x.academic_year_id
         join app.student_cohorts c on c.id=x.cohort_id
         where x.status='active' and y.status='active'
         order by y.starts_on desc nulls last,c.name,x.name`,
      );
      return result.rows.map((row) => ({
        id: row.id, levelId: row.level_id, name: row.name, code: row.code,
        academicYearName: row.academic_year_name, cohortName: row.cohort_name,
      }));
    });
  }

  async update(actor: AuthUser, requestId: string, input: {
    email: string; phone: string; displayName: string; studentNumber: string | null; academicLevelId: string;
  }) {
    await withUserContext(actor, async (client) => {
      await client.query('select app.admin_update_student_registration($1, $2, $3, $4, $5, $6, $7)', [
        actor.id, requestId, input.email, input.phone, input.displayName, input.studentNumber, input.academicLevelId,
      ]);
    });
  }

  async decide(actor: AuthUser, requestId: string, decision: 'approved' | 'rejected' | 'changes_requested', reason: string | null, sectionId: string | null) {
    return withUserContext(actor, async (client) => {
      const result = await client.query<{ admin_decide_student_registration_with_section: string | null }>(
        'select app.admin_decide_student_registration_with_section($1, $2, $3, $4, $5)',
        [actor.id, requestId, decision, reason, sectionId],
      );
      return result.rows[0]!.admin_decide_student_registration_with_section;
    });
  }
}

function mapStatus(row: RegistrationRow) {
  return {
    id: row.request_id!, email: row.email, phone: row.phone_e164, displayName: row.display_name,
    studentNumber: row.student_number, status: row.status, decisionReason: row.decision_reason,
    departmentName: row.department_name, specializationName: row.specialization_name, levelName: row.level_name,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapAdminRow(row: RegistrationRow) {
  return {
    id: row.id!, email: row.email, phone: row.phone_e164, displayName: row.display_name,
    studentNumber: row.student_number, status: row.status, decisionReason: row.decision_reason,
    academicLevelId: row.academic_level_id ?? row.level_id!, levelId: row.level_id!, levelName: row.level_name,
    specializationId: row.specialization_id!, specializationName: row.specialization_name,
    departmentId: row.department_id!, departmentName: row.department_name,
    createdAt: row.created_at, updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at ?? null, reviewedByName: row.reviewed_by_name ?? null,
  };
}
