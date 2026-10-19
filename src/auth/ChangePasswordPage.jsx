import Brand from '../components/Brand';
import PasswordChangeForm from './PasswordChangeForm';

export default function ChangePasswordPage() {
  return <main className="password-page"><section className="password-card"><Brand /><h1>أنشئ كلمة مرور خاصة بك</h1><p>هذا الحساب يستخدم كلمة مرور مؤقتة. يجب تغييرها قبل الوصول إلى بيانات المنصة.</p><PasswordChangeForm /></section></main>;
}
