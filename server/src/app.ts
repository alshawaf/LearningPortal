import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { AuthRepository } from './repositories/auth-repository.js';
import { CourseRepository } from './repositories/course-repository.js';
import { AcademicStructureRepository } from './repositories/academic-structure-repository.js';
import { PracticeRepository } from './repositories/practice-repository.js';
import { StudentActivityRepository } from './repositories/student-activity-repository.js';
import { StudentRegistrationRepository } from './repositories/student-registration-repository.js';
import { CourseOfferingRepository } from './repositories/course-offering-repository.js';
import { LearningActivityRepository } from './repositories/learning-activity-repository.js';
import { AuthService, AuthenticationError, AuthorizationError, ValidationError } from './services/auth-service.js';
import { createAuthHooks } from './plugins/auth.js';
import { registerAuthRoutes } from './routes/auth-routes.js';
import { registerAdminRoutes } from './routes/admin-routes.js';
import { registerCourseRoutes } from './routes/course-routes.js';
import { registerPlatformRoutes } from './routes/platform-routes.js';
import { registerAcademicStructureRoutes } from './routes/academic-structure-routes.js';
import { registerPracticeRoutes } from './routes/practice-routes.js';
import { registerStudentActivityRoutes } from './routes/student-activity-routes.js';
import { registerStudentRegistrationRoutes } from './routes/student-registration-routes.js';
import { registerCourseOfferingRoutes } from './routes/course-offering-routes.js';
import { registerLearningActivityRoutes } from './routes/learning-activity-routes.js';
import { PracticeRunnerError } from './services/practice-runner-contracts.js';
import { StudentRegistrationService } from './services/student-registration-service.js';
import { runnerHealth } from './services/practice-execution-client.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.isProduction ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.confirmPassword', 'req.body.currentPassword', 'req.body.newPassword', 'req.body.temporaryPassword', 'req.body.sourceCode', 'req.body.referenceSolution'],
    },
    bodyLimit: 524_288,
    trustProxy: config.trustedProxy,
    requestIdHeader: false,
    logController: new LogController({ disableRequestLogging: config.nodeEnv === 'test' }),
  });

  app.decorateRequest('authUser', null);
  app.decorateRequest('authSession', null);

  await app.register(cookie);
  await app.register(cors, { origin: config.webOrigin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] });
  await app.register(helmet, {
    contentSecurityPolicy: config.isProduction ? {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"],
      },
    } : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute', ban: 3 });

  app.addHook('onRequest', async (request, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin !== config.webOrigin) {
        return reply.code(403).send({ error: { code: 'ORIGIN_INVALID', message: 'مصدر الطلب غير مسموح.' } });
      }
    }
  });

  const authRepository = new AuthRepository(pool);
  const authService = await AuthService.create(authRepository, config.sessionTtlHours);
  const courseRepository = new CourseRepository();
  const academicStructureRepository = new AcademicStructureRepository();
  const practiceRepository = new PracticeRepository();
  const studentActivityRepository = new StudentActivityRepository();
  const studentRegistrationService = new StudentRegistrationService(new StudentRegistrationRepository());
  const courseOfferingRepository = new CourseOfferingRepository();
  const learningActivityRepository = new LearningActivityRepository();
  const authHooks = createAuthHooks(authService, config.isProduction);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'بعض البيانات المدخلة غير صحيحة.', fields: error.flatten().fieldErrors } });
    }
    if (error instanceof ValidationError) {
      return reply.code(400).send({ error: { code: 'PASSWORD_POLICY', message: error.details[0], details: error.details } });
    }
    if (error instanceof AuthenticationError) {
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: error.message } });
    }
    if (error instanceof AuthorizationError) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: error.message } });
    }
    if (error instanceof PracticeRunnerError) {
      return reply.code(error.isInfrastructureFailure ? 503 : 400).send({ error: { code: 'PRACTICE_RUNNER_ERROR', message: error.message } });
    }
    if ((error as { code?: string }).code === 'PRACTICE_REFERENCE_INVALID') {
      return reply.code(422).send({ error: { code: 'PRACTICE_REFERENCE_INVALID', message: (error as Error).message } });
    }
    if ((error as { code?: string }).code === 'PRACTICE_PUBLISHED_COURSE_LOCKED') {
      return reply.code(409).send({ error: { code: 'PRACTICE_PUBLISHED_COURSE_LOCKED', message: (error as Error).message } });
    }
    if ((error as { code?: string }).code === 'OFFERING_CONTEXT_LOCKED') {
      return reply.code(409).send({ error: { code: 'OFFERING_CONTEXT_LOCKED', message: 'لا يمكن تغيير المقرر أو الفصل أو رمز الشعبة بعد تسجيل الطلاب أو إضافة أنشطة. يمكنك تغيير الأستاذ أو الحالة فقط.' } });
    }
    if ((error as { code?: string }).code === 'ACADEMIC_CONTEXT_LOCKED') {
      return reply.code(409).send({ error: { code: 'ACADEMIC_CONTEXT_LOCKED', message: 'لا يمكن تغيير المسار الأكاديمي لسجل بدأ استخدامه. يمكنك تعديل الاسم والرمز والحالة، أو إنشاء سجل جديد للسياق الجديد.' } });
    }
    const pgCode = (error as { code?: string }).code;
    if (pgCode === '23505') {
      const constraint = (error as { constraint?: string }).constraint;
      const message = constraint?.startsWith('registration_')
        ? 'تعذر إنشاء الطلب بهذه البيانات. إذا سبق لك التسجيل فتواصل مع إدارة المنصة.'
        : 'يوجد سجل آخر بالقيمة نفسها.';
      return reply.code(409).send({ error: { code: 'CONFLICT', message } });
    }
    if (pgCode === '23514') {
      const constraint = (error as { constraint?: string }).constraint;
      const message = constraint === 'users_last_active_admin'
        ? 'لا يمكن إزالة أو إيقاف آخر مدير نشط في المنصة.'
        : constraint === 'admin_self_protection'
          ? 'لا يمكنك تغيير دور حسابك أو حالته من جلستك الحالية.'
          : constraint === 'course_owner_active_instructor'
            ? 'يجب اختيار أستاذ نشط ومسجّل في النظام.'
          : constraint === 'course_offering_active_instructor'
          ? 'يجب ربط طرح المقرر بأستاذ نشط.'
          : constraint === 'course_offering_context_match'
          ? 'يجب أن يتبع الفصل الدراسي والشعبة العام الأكاديمي نفسه، مع اختيار أستاذ نشط.'
          : constraint === 'section_specialization_match'
          ? 'يجب أن يتبع مستوى الشعبة تخصص الدفعة نفسه.'
          : constraint === 'section_member_active_student'
          ? 'يمكن إسناد حساب طالب نشط فقط إلى الشعبة.'
          : constraint === 'course_offering_member_active_role'
          ? 'عضوية طرح المقرر لا تتطابق مع دور المستخدم أو حالته.'
          : constraint === 'course_level_active_hierarchy'
            ? 'يجب اختيار مستوى نشط تابع لتخصص ودائرة نشطين.'
          : constraint === 'academic_parent_active'
            ? 'السجل الأكاديمي الأب غير موجود أو غير نشط.'
          : constraint === 'student_academic_level_active'
            ? 'يجب اختيار مستوى أكاديمي نشط للطالب.'
          : constraint === 'course_enrollment_active_course'
            ? 'يجب تفعيل المقرر قبل مزامنة الطلاب.'
          : constraint === 'course_enrollment_active_student'
            ? 'يمكن تسجيل حساب طالب نشط فقط.'
          : constraint === 'course_enrollment_reason_required'
            ? 'يجب كتابة سبب واضح عند سحب الطالب أو تعليق تسجيله.'
          : constraint === 'registration_level_active'
            ? 'يجب اختيار مستوى أكاديمي نشط.'
          : constraint === 'registration_request_reviewable'
            ? 'لا يمكن تعديل أو مراجعة طلب حُسم مسبقاً.'
          : constraint === 'registration_decision_reason_required'
            ? 'يجب كتابة سبب واضح لطلب التعديل أو الرفض.'
          : constraint === 'registration_section_required'
            ? 'يجب اختيار شعبة للطالب عند الموافقة على الطلب.'
          : constraint === 'registration_section_eligible'
            ? 'الشعبة المختارة غير نشطة أو لا تطابق مستوى الطالب.'
          : 'القيمة المطلوبة تخالف قواعد سلامة البيانات.';
      return reply.code(409).send({ error: { code: 'ACCOUNT_SAFETY_CONFLICT', message } });
    }
    if (pgCode === '42501') {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'ليست لديك صلاحية لتنفيذ هذه العملية.' } });
    }
    if (pgCode === 'P0002') {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'السجل الأكاديمي غير موجود.' } });
    }
    request.log.error({ err: error, requestId: request.id }, 'Unhandled request error');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'حدث خطأ غير متوقع.', requestId: request.id } });
  });

  app.get('/health', async (_request, reply) => {
    await pool.query('select 1');
    return reply.send({ status: 'ok' });
  });
  app.get('/ready', async (_request, reply) => {
    await pool.query('select 1');
    const runner = await runnerHealth();
    return reply.send({ status: 'ready', runner });
  });

  await app.register(async (api) => {
    await api.register(async (routes) => registerAuthRoutes(routes, authService, authHooks, config.isProduction, config.sessionTtlHours), { prefix: '/auth' });
    await api.register(async (routes) => registerAdminRoutes(routes, authService, authHooks), { prefix: '/admin' });
    await api.register(async (routes) => registerCourseRoutes(routes, courseRepository, authHooks), { prefix: '/courses' });
    await api.register(async (routes) => registerAcademicStructureRoutes(routes, academicStructureRepository, authHooks), { prefix: '/academic-structure' });
    await api.register(async (routes) => registerPracticeRoutes(routes, practiceRepository, authHooks), { prefix: '/practice' });
    await api.register(async (routes) => registerStudentActivityRoutes(routes, studentActivityRepository, authHooks), { prefix: '/student-activity' });
    await api.register(async (routes) => registerStudentRegistrationRoutes(routes, studentRegistrationService, authHooks, config.isProduction), { prefix: '/registration' });
    await api.register(async (routes) => registerCourseOfferingRoutes(routes, courseOfferingRepository, courseRepository, authHooks), { prefix: '/course-offerings' });
    await api.register(async (routes) => registerLearningActivityRoutes(routes, learningActivityRepository, authHooks), { prefix: '/activities' });
    await api.register(async (routes) => registerPlatformRoutes(routes, courseRepository, authHooks));
  }, { prefix: '/api/v1' });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'المسار غير موجود.' } }));

  app.addHook('onClose', async () => { await pool.end(); });
  return app;
}
