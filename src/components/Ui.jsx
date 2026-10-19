import { ArrowLeft, CheckCircle2 } from 'lucide-react';

export function PageHeading({ title, description, action }) {
  return <div className="page-heading"><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{action}</div>;
}

export function Progress({ value, color = '#0877ad' }) {
  return <div className="progress" aria-label={`التقدم ${value}%`}><span style={{ width: `${value}%`, background: color }} /></div>;
}

export function EmptyState({ title, text, action = null }) {
  return <div className="empty-state"><CheckCircle2 size={40} /><h3>{title}</h3><p>{text}</p>{action}</div>;
}

export function DataState({ loading, error, empty, children }) {
  if (loading) return <div className="data-state">جارٍ تحميل البيانات...</div>;
  if (error) return <div className="auth-error" role="alert">{error}</div>;
  if (empty) return <EmptyState title="لا توجد بيانات بعد" text="ستظهر السجلات هنا فور إضافتها إلى المنصة." />;
  return children;
}

export function PrimaryButton({ children, icon = true, ...props }) {
  return <button className="button button--primary" {...props}>{children}{icon ? <ArrowLeft size={17} /> : null}</button>;
}
