import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createAuthHooks } from '../plugins/auth.js';
import { CourseOfferingRepository } from '../repositories/course-offering-repository.js';
import { CourseRepository } from '../repositories/course-repository.js';

type Hooks=ReturnType<typeof createAuthHooks>;
const id=z.string().uuid();
const calendar=z.object({code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,24}$/),name:z.string().trim().min(2).max(120),startsOn:z.string().date().nullable(),endsOn:z.string().date().nullable(),status:z.enum(['planned','active','completed','archived'])}).strict().superRefine((v,c)=>{if(v.startsOn&&v.endsOn&&v.endsOn<v.startsOn)c.addIssue({code:'custom',path:['endsOn'],message:'تاريخ النهاية يجب ألا يسبق البداية.'});});
const term=calendar.extend({academicYearId:id,termNumber:z.number().int().min(1).max(6)});
const cohort=z.object({specializationId:id,code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,32}$/),name:z.string().trim().min(2).max(160),admissionYear:z.number().int().min(2000).max(2200),status:z.enum(['planned','active','graduated','archived'])}).strict();
const section=z.object({cohortId:id,levelId:id,academicYearId:id,code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,32}$/),name:z.string().trim().min(2).max(160),status:z.enum(['planned','active','completed','archived'])}).strict();
const offering=z.object({courseId:id,termId:id,sectionId:id,instructorUserId:id,status:z.enum(['planned','active','completed','archived'])}).strict();
const membership=z.object({studentId:id}).strict();
const membershipStatus=z.object({status:z.enum(['active','withdrawn','completed','suspended']),reason:z.string().trim().min(3).max(500).nullable().default(null)}).strict();
const assignment=z.object({title:z.string().trim().min(3).max(180),description:z.string().max(20000).default(''),dueAt:z.string().datetime({offset:true}).nullable().default(null),maxScore:z.number().positive().max(10000).default(10),publish:z.boolean().default(false),language:z.enum(['python','javascript']).default('python'),starterCode:z.string().max(100000).default('')}).strict();

export async function registerCourseOfferingRoutes(app:FastifyInstance,repo:CourseOfferingRepository,courses:CourseRepository,hooks:Hooks){
 const authenticated=[hooks.requireAuth,hooks.requirePasswordEstablished]; const admin=[...authenticated,hooks.requireRole('admin'),hooks.requireCsrf];
 const param=(request:unknown,key:string)=>z.object({[key]:id}).parse(request)[key] as string;
 app.get('/',{preHandler:authenticated},async request=>repo.list(request.authUser!));
 app.post('/years',{preHandler:admin},async(request,reply)=>reply.code(201).send({id:await repo.createYear(request.authUser!,calendar.parse(request.body))}));
 app.patch('/years/:yearId',{preHandler:admin},async request=>{await repo.updateYear(request.authUser!,param(request.params,'yearId'),calendar.parse(request.body));return{message:'تم تحديث العام الأكاديمي.'};});
 app.post('/terms',{preHandler:admin},async(request,reply)=>reply.code(201).send({id:await repo.createTerm(request.authUser!,term.parse(request.body))}));
 app.patch('/terms/:termId',{preHandler:admin},async request=>{await repo.updateTerm(request.authUser!,param(request.params,'termId'),term.parse(request.body));return{message:'تم تحديث الفصل الدراسي.'};});
 app.post('/cohorts',{preHandler:admin},async(request,reply)=>reply.code(201).send({id:await repo.createCohort(request.authUser!,cohort.parse(request.body))}));
 app.patch('/cohorts/:cohortId',{preHandler:admin},async request=>{await repo.updateCohort(request.authUser!,param(request.params,'cohortId'),cohort.parse(request.body));return{message:'تم تحديث الدفعة.'};});
 app.post('/sections',{preHandler:admin},async(request,reply)=>reply.code(201).send({id:await repo.createSection(request.authUser!,section.parse(request.body))}));
 app.patch('/sections/:sectionId',{preHandler:admin},async request=>{await repo.updateSection(request.authUser!,param(request.params,'sectionId'),section.parse(request.body));return{message:'تم تحديث الشعبة.'};});
 app.get('/sections/:sectionId/students',{preHandler:[...authenticated,hooks.requireRole('admin','instructor')]},async request=>repo.listSectionStudents(request.authUser!,param(request.params,'sectionId')));
 app.post('/sections/:sectionId/students',{preHandler:admin},async(request,reply)=>{const sectionId=param(request.params,'sectionId');await repo.addSectionStudent(request.authUser!,sectionId,membership.parse(request.body).studentId);return reply.code(201).send({message:'تم إسناد الطالب إلى الشعبة.'});});
 app.patch('/sections/:sectionId/students/:studentId',{preHandler:admin},async request=>{const p=z.object({sectionId:id,studentId:id}).parse(request.params);const body=membershipStatus.parse(request.body);await repo.updateSectionStudent(request.authUser!,p.sectionId,p.studentId,body.status,body.reason);return{message:'تم تحديث عضوية الطالب في الشعبة.'};});
 app.post('/',{preHandler:admin},async(request,reply)=>reply.code(201).send({id:await repo.createOffering(request.authUser!,offering.parse(request.body))}));
 app.patch('/:offeringId',{preHandler:admin},async request=>{await repo.updateOffering(request.authUser!,param(request.params,'offeringId'),offering.parse(request.body));return{message:'تم تحديث طرح المقرر.'};});
 app.get('/:offeringId/enrollments',{preHandler:[...authenticated,hooks.requireRole('admin','instructor')]},async request=>courses.listEnrollments(request.authUser!,param(request.params,'offeringId')));
 app.get('/:offeringId/assignments',{preHandler:authenticated},async request=>({assignments:await courses.listAssignments(request.authUser!,param(request.params,'offeringId'))}));
 app.post('/:offeringId/assignments',{preHandler:[...authenticated,hooks.requireRole('admin','instructor'),hooks.requireCsrf]},async(request,reply)=>{const offeringId=param(request.params,'offeringId');const body=assignment.parse(request.body);return reply.code(201).send({assignment:await courses.createAssignment(request.authUser!,offeringId,{...body,dueAt:body.dueAt?new Date(body.dueAt):null})});});
}
