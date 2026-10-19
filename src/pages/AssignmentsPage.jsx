import { CheckCircle2, Clock3, FileCode2, Plus } from 'lucide-react';
import { DataState, PageHeading, PrimaryButton } from '../components/Ui';

const dateFormatter = new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeStyle: 'short' });

export default function AssignmentsPage({ role, assignments, loading, error, onOpenWorkspace, onCreate }) {
  const instructor = role === 'teacher' || role === 'admin';
  return <div className="stack-lg">
    <PageHeading title={instructor ? 'إدارة الواجبات' : 'الواجبات'} description={instructor ? 'أنشئ الواجبات وتابع التسليمات المحفوظة.' : 'الواجبات المنشورة في مقرراتك.'} action={instructor ? <PrimaryButton icon={false} onClick={onCreate}><Plus size={18} /> واجب جديد</PrimaryButton> : null} />
    <DataState loading={loading} error={error} empty={!assignments.length}>
      <div className="table-shell"><table>
        <thead><tr><th>الواجب</th><th>المقرر</th><th>موعد التسليم</th><th>الحالة</th><th>{instructor ? 'التسليمات' : 'الدرجة'}</th><th></th></tr></thead>
        <tbody>{assignments.map((item) => {
          const status = instructor ? (item.publishedAt ? 'منشور' : 'مسودة') : item.latestStatus === 'graded' ? 'مقيّم' : item.latestSubmissionId ? 'قيد المراجعة' : 'لم يُسلّم';
          const success = status === 'مقيّم' || status === 'منشور';
          return <tr key={item.id}>
            <td><span className="table-title"><FileCode2 /> <strong>{item.title}</strong></span></td><td><strong>{item.courseTitle}</strong><small className="cell-subtitle">{item.termName} · الشعبة {item.sectionCode}</small></td><td>{item.dueAt ? dateFormatter.format(new Date(item.dueAt)) : 'دون موعد'}</td>
            <td><span className={`status status--${success ? 'success' : item.latestSubmissionId ? 'progress' : 'muted'}`}>{success ? <CheckCircle2 /> : <Clock3 />}{status}</span></td>
            <td>{instructor ? item.submissionCount : item.latestScore == null ? '—' : `${item.latestScore} / ${item.maxScore}`}</td>
            <td><button className="table-action" onClick={() => onOpenWorkspace(item)}>{instructor ? 'عرض التسليمات' : 'فتح'}</button></td>
          </tr>;
        })}</tbody>
      </table></div>
    </DataState>
  </div>;
}
