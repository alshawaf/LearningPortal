import type { AuthUser } from '../domain/auth.js';
import { withUserContext } from '../db/pool.js';

type StructureRow = {
  department_id: string; department_code: string; department_name: string;
  specialization_id: string | null; specialization_code: string | null; specialization_name: string | null;
  level_id: string | null; level_number: number | null; level_name: string | null;
};

export class AcademicStructureRepository {
  list(user: AuthUser) {
    return withUserContext(user, async (client) => {
      const result = await client.query<StructureRow>(
        `select d.id as department_id, d.code as department_code, d.name as department_name,
                s.id as specialization_id, s.code as specialization_code, s.name as specialization_name,
                l.id as level_id, l.level_number, l.name as level_name
         from app.academic_departments d
         left join app.specializations s on s.department_id = d.id and s.is_active
         left join app.academic_levels l on l.specialization_id = s.id and l.is_active
         where d.is_active
         order by d.name, s.name, l.level_number`,
      );

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
        if (!row.specialization_id || !row.specialization_code || !row.specialization_name) continue;
        let specialization = department.specializations.get(row.specialization_id);
        if (!specialization) {
          specialization = { id: row.specialization_id, code: row.specialization_code, name: row.specialization_name, levels: [] };
          department.specializations.set(row.specialization_id, specialization);
        }
        if (row.level_id && row.level_number !== null && row.level_name) {
          specialization.levels.push({ id: row.level_id, number: row.level_number, name: row.level_name });
        }
      }
      return [...departments.values()].map((department) => ({
        id: department.id, code: department.code, name: department.name,
        specializations: [...department.specializations.values()],
      }));
    });
  }

  createDepartment(user: AuthUser, input: { code: string; name: string }) {
    return withUserContext(user, async (client) => {
      const created = await client.query<{ admin_create_department: string }>(
        'select app.admin_create_department($1, $2, $3)', [user.id, input.code, input.name],
      );
      return { id: created.rows[0]!.admin_create_department, code: input.code, name: input.name, specializations: [] };
    });
  }

  createSpecialization(user: AuthUser, departmentId: string, input: { code: string; name: string }) {
    return withUserContext(user, async (client) => {
      const created = await client.query<{ admin_create_specialization: string }>(
        'select app.admin_create_specialization($1, $2, $3, $4)', [user.id, departmentId, input.code, input.name],
      );
      return { id: created.rows[0]!.admin_create_specialization, departmentId, code: input.code, name: input.name, levels: [] };
    });
  }

  createLevel(user: AuthUser, specializationId: string, input: { number: number; name: string }) {
    return withUserContext(user, async (client) => {
      const created = await client.query<{ admin_create_academic_level: string }>(
        'select app.admin_create_academic_level($1, $2, $3::smallint, $4)', [user.id, specializationId, input.number, input.name],
      );
      return { id: created.rows[0]!.admin_create_academic_level, specializationId, number: input.number, name: input.name };
    });
  }

  updateDepartment(user: AuthUser, departmentId: string, input: { code: string; name: string }) {
    return withUserContext(user, async (client) => {
      await client.query('select app.admin_update_department($1, $2, $3, $4)', [user.id, departmentId, input.code, input.name]);
    });
  }

  updateSpecialization(user: AuthUser, specializationId: string, input: { code: string; name: string }) {
    return withUserContext(user, async (client) => {
      await client.query('select app.admin_update_specialization($1, $2, $3, $4)', [user.id, specializationId, input.code, input.name]);
    });
  }

  updateLevel(user: AuthUser, levelId: string, input: { number: number; name: string }) {
    return withUserContext(user, async (client) => {
      await client.query('select app.admin_update_academic_level($1, $2, $3::smallint, $4)', [user.id, levelId, input.number, input.name]);
    });
  }
}
