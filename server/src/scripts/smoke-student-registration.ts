import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../app.js';
import { hashPassword } from '../security/password.js';

const databaseUrl = process.env.DATABASE_ADMIN_URL;
const origin = process.env.WEB_ORIGIN;
if (!databaseUrl || !origin) throw new Error('DATABASE_ADMIN_URL and WEB_ORIGIN are required');

const stamp = Date.now();
const suffix = String(stamp).slice(-8);
const adminEmail = `registration.admin.${stamp}@example.test`;
const instructorEmail = `registration.instructor.${stamp}@example.test`;
const applicantEmail = `registration.student.${stamp}@example.test`;
const editedEmail = `registration.student.edited.${stamp}@example.test`;
const password = 'Registration-Smoke-2026!';
const client = new pg.Client({ connectionString: databaseUrl });
const userIds: string[] = [];
let requestId: string | null = null;
let app: Awaited<ReturnType<typeof buildApp>> | null = null;

function cookiesFrom(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const values = response.headers['set-cookie'];
  const list = Array.isArray(values) ? values : typeof values === 'string' ? [values] : [];
  return list.map((value) => value.split(';', 1)[0]).join('; ');
}
function cookieValue(cookieHeader: string, name: string) {
  const entry = cookieHeader.split('; ').find((item) => item.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

try {
  await client.connect();
  const passwordHash = await hashPassword(password);
  const level = await client.query<{ id: string }>(
    `select l.id from app.academic_levels l
     join app.specializations s on s.id = l.specialization_id
     join app.academic_departments d on d.id = s.department_id
     where l.is_active and s.is_active and d.is_active order by l.created_at limit 1`,
  );
  const levelId = level.rows[0]?.id;
  assert.ok(levelId, 'Academic hierarchy must include an active level');

  for (const input of [
    { email: adminEmail, phone: `+96771${suffix.slice(-7)}`, name: 'مدير اختبار التسجيل', role: 'admin' },
    { email: instructorEmail, phone: `+96772${suffix.slice(-7)}`, name: 'أستاذ اختبار التسجيل', role: 'instructor' },
  ]) {
    const inserted = await client.query<{ id: string }>(
      'insert into app.users(email, phone_e164, display_name, role) values ($1::citext, $2, $3, $4) returning id',
      [input.email, input.phone, input.name, input.role],
    );
    userIds.push(inserted.rows[0]!.id);
    await client.query('insert into app.password_credentials(user_id, password_hash) values ($1, $2)', [inserted.rows[0]!.id, passwordHash]);
  }
  app = await buildApp();

  const options = await app.inject({ method: 'GET', url: '/api/v1/registration/options' });
  assert.equal(options.statusCode, 200, options.body);
  assert.ok(options.json().departments.length > 0);

  const submission = await app.inject({ method: 'POST', url: '/api/v1/registration', headers: { origin }, payload: {
    email: applicantEmail, phone: `+96773${suffix.slice(-7)}`, displayName: 'طالب طلب التسجيل', studentNumber: `ST${suffix}`,
    academicLevelId: levelId, password, confirmPassword: password,
  } });
  assert.equal(submission.statusCode, 201, submission.body);
  requestId = submission.json().id;
  const trackingCookies = cookiesFrom(submission);
  assert.ok(cookieValue(trackingCookies, 'mc_registration'));

  const pendingStatus = await app.inject({ method: 'GET', url: '/api/v1/registration/status', headers: { cookie: trackingCookies } });
  assert.equal(pendingStatus.statusCode, 200, pendingStatus.body);
  assert.equal(pendingStatus.json().registration.status, 'pending');

  const loginBeforeApproval = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { identifier: applicantEmail, password } });
  assert.equal(loginBeforeApproval.statusCode, 401, loginBeforeApproval.body);

  const adminLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { identifier: adminEmail, password } });
  assert.equal(adminLogin.statusCode, 200, adminLogin.body);
  const adminCookies = cookiesFrom(adminLogin);
  const csrf = cookieValue(adminCookies, 'mc_csrf');

  const list = await app.inject({ method: 'GET', url: '/api/v1/registration/admin', headers: { cookie: adminCookies } });
  assert.equal(list.statusCode, 200, list.body);
  assert.ok(list.json().requests.some((request: { id: string }) => request.id === requestId));

  const update = await app.inject({ method: 'PATCH', url: `/api/v1/registration/admin/${requestId}`, headers: { origin, cookie: adminCookies, 'x-csrf-token': csrf }, payload: {
    email: editedEmail, phone: `+96774${suffix.slice(-7)}`, displayName: 'طالب معدّل من الإدارة', studentNumber: `ED${suffix}`,
    academicLevelId: levelId,
  } });
  assert.equal(update.statusCode, 200, update.body);

  const changesRequested = await app.inject({ method: 'POST', url: `/api/v1/registration/admin/${requestId}/decision`, headers: { origin, cookie: adminCookies, 'x-csrf-token': csrf }, payload: {
    decision: 'changes_requested', reason: 'يرجى مراجعة بيانات الهوية مع الإدارة.',
  } });
  assert.equal(changesRequested.statusCode, 200, changesRequested.body);
  const changedStatus = await app.inject({ method: 'GET', url: '/api/v1/registration/status', headers: { cookie: trackingCookies } });
  assert.equal(changedStatus.json().registration.status, 'changes_requested');
  assert.match(changedStatus.json().registration.decisionReason, /مراجعة/);

  const approval = await app.inject({ method: 'POST', url: `/api/v1/registration/admin/${requestId}/decision`, headers: { origin, cookie: adminCookies, 'x-csrf-token': csrf }, payload: {
    decision: 'approved', reason: null,
  } });
  assert.equal(approval.statusCode, 200, approval.body);
  const approvedUserId = approval.json().approvedUserId;
  assert.ok(approvedUserId);
  userIds.push(approvedUserId);

  const approvedLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { identifier: editedEmail, password } });
  assert.equal(approvedLogin.statusCode, 200, approvedLogin.body);
  assert.equal(approvedLogin.json().user.role, 'student');

  const membership = await client.query(`select count(*)::int as count from app.section_memberships where student_user_id=$1`,[approvedUserId]);
  assert.equal(membership.rows[0].count,0,'Approving an account must not guess or auto-assign a section');

  const studentAdminDenied = await app.inject({ method: 'GET', url: '/api/v1/registration/admin', headers: { cookie: cookiesFrom(approvedLogin) } });
  assert.equal(studentAdminDenied.statusCode, 403, studentAdminDenied.body);

  const audits = await client.query(
    `select action from app.audit_logs where target_id = $1 order by created_at`, [requestId],
  );
  assert.deepEqual(audits.rows.map((row) => row.action), [
    'registration.submitted', 'registration.updated_by_admin', 'registration.changes_requested', 'registration.approved',
  ]);
  console.log('Student registration submission, review, admin editing, approval without implicit section assignment, and isolation smoke test passed.');
} finally {
  if (app) await app.close();
  if (requestId) await client.query('delete from app.audit_logs where target_id = $1', [requestId]).catch(() => undefined);
  if (userIds.length) await client.query('delete from app.audit_logs where actor_user_id = any($1::uuid[]) or target_id = any($1::uuid[])', [userIds]).catch(() => undefined);
  if (requestId) await client.query('delete from app.student_registration_requests where id = $1', [requestId]).catch(() => undefined);
  if (userIds.length) await client.query('delete from app.users where id = any($1::uuid[])', [userIds]).catch(() => undefined);
  await client.end().catch(() => undefined);
}
