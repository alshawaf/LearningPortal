import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import CreateModal from './components/CreateModal';
import StudentDashboard from './pages/StudentDashboard';
import AssignmentsPage from './pages/AssignmentsPage';
import GradesPage from './pages/GradesPage';
import OverviewPage from './pages/OverviewPage';
import { useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import ChangePasswordPage from './auth/ChangePasswordPage';
import { RegistrationStatusPage, StudentRegistrationPage } from './auth/StudentRegistrationPage';
import { usePlatformData } from './hooks/usePlatformData';
import { DEFAULT_PAGE, isPageAllowed, pageFromLocation, pagePath, writePagePath } from './lib/navigation';

const Workspace = lazy(() => import('./pages/Workspace'));
const PeoplePage = lazy(() => import('./pages/PeoplePage'));
const AcademicStructurePage = lazy(() => import('./pages/AcademicStructurePage'));
const CoursesPage = lazy(() => import('./pages/CoursesPage'));
const PracticesPage = lazy(() => import('./pages/PracticesPage'));
const PracticeWorkspace = lazy(() => import('./pages/PracticeWorkspace'));
const StudentActivityPage = lazy(() => import('./pages/StudentActivityPage'));
const AcademicDeliveryPage = lazy(() => import('./pages/AcademicDeliveryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

export default function App() {
  const { user, loading, logout, refreshSession } = useAuth();
  const [page, setPage] = useState(() => pageFromLocation());
  const [workspace, setWorkspace] = useState(null);
  const [practiceWorkspace, setPracticeWorkspace] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalType, setModalType] = useState(null);

  if (loading) return <div className="app-loading"><span className="loading-mark">&lt;/&gt;</span><p>جارٍ التحقق من الجلسة...</p></div>;
  if (!user) return <PublicAuthFlow />;
  if (user.mustChangePassword) return <ChangePasswordPage />;

  const role = user.role === 'instructor' ? 'teacher' : user.role;
  return <AuthenticatedApp user={user} role={role} page={page} setPage={setPage} workspace={workspace} setWorkspace={setWorkspace} practiceWorkspace={practiceWorkspace} setPracticeWorkspace={setPracticeWorkspace} menuOpen={menuOpen} setMenuOpen={setMenuOpen} modalType={modalType} setModalType={setModalType} logout={logout} refreshSession={refreshSession} />;
}

function PublicAuthFlow() {
  const routeFromLocation = () => window.location.pathname === '/register' ? 'register' : window.location.pathname === '/registration-status' ? 'status' : 'login';
  const [route, setRoute] = useState(routeFromLocation);
  const navigate = useCallback((nextRoute) => {
    const path = nextRoute === 'register' ? '/register' : nextRoute === 'status' ? '/registration-status' : '/login';
    window.history.pushState({ publicAuth: nextRoute }, '', path);
    setRoute(nextRoute);
  }, []);
  useEffect(() => {
    const restore = () => setRoute(routeFromLocation());
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  if (route === 'register') return <StudentRegistrationPage onNavigate={navigate} />;
  if (route === 'status') return <RegistrationStatusPage onNavigate={navigate} />;
  return <LoginPage onRegister={() => navigate('register')} />;
}

function AuthenticatedApp({ user, role, page, setPage, workspace, setWorkspace, practiceWorkspace, setPracticeWorkspace, menuOpen, setMenuOpen, modalType, setModalType, logout, refreshSession }) {
  const platformRole = role === 'teacher' ? 'instructor' : role;
  const platform = usePlatformData(platformRole);
  const currentPage = isPageAllowed(page, role) ? page : DEFAULT_PAGE;
  const navigate = useCallback((nextPage) => {
    const allowedPage = isPageAllowed(nextPage, role) ? nextPage : DEFAULT_PAGE;
    writePagePath(allowedPage);
    setPage(allowedPage);
    setWorkspace(null);
    setPracticeWorkspace(null);
  }, [role, setPage, setPracticeWorkspace, setWorkspace]);

  useEffect(() => {
    if (currentPage !== page) {
      writePagePath(currentPage, { replace: true });
      setPage(currentPage);
    } else if (window.location.pathname !== pagePath(currentPage) || window.location.hash) {
      writePagePath(currentPage, { replace: true });
    }
  }, [currentPage, page, setPage]);

  useEffect(() => {
    const restorePage = () => {
      const restored = pageFromLocation();
      const allowedPage = isPageAllowed(restored, role) ? restored : DEFAULT_PAGE;
      if (allowedPage !== restored || window.location.pathname !== pagePath(allowedPage) || window.location.hash) {
        writePagePath(allowedPage, { replace: true });
      }
      setPage(allowedPage);
      setWorkspace(null);
      setPracticeWorkspace(null);
    };
    window.addEventListener('popstate', restorePage);
    window.addEventListener('hashchange', restorePage);
    return () => {
      window.removeEventListener('popstate', restorePage);
      window.removeEventListener('hashchange', restorePage);
    };
  }, [role, setPage, setPracticeWorkspace, setWorkspace]);
  if (workspace) return <Suspense fallback={<div className="app-loading">جارٍ فتح مساحة الواجب...</div>}><Workspace assignment={workspace} role={role} onBack={() => setWorkspace(null)} onSubmitted={platform.refresh} /></Suspense>;
  if (practiceWorkspace) return <Suspense fallback={<div className="app-loading">جارٍ فتح مساحة التدريب...</div>}><PracticeWorkspace summary={practiceWorkspace} onBack={() => setPracticeWorkspace(null)} /></Suspense>;

  let content;
  const shared = { loading: platform.loading, error: platform.error };
  if (currentPage === 'dashboard') content = role === 'student'
    ? <StudentDashboard user={user} courses={platform.courses} assignments={platform.assignments} onNavigate={navigate} onOpenWorkspace={setWorkspace} {...shared} />
    : <OverviewPage role={role} courses={platform.courses} assignments={platform.assignments} people={platform.people} onNavigate={navigate} onCreate={() => setModalType(role === 'admin' ? 'course' : 'assignment')} {...shared} />;
  else if (currentPage === 'courses') content = <CoursesPage role={role} courses={role === 'admin' ? platform.catalogCourses : platform.courses} instructors={platform.people.filter((person) => person.role === 'instructor' && person.status === 'active')} departments={platform.departments} onRefresh={platform.refresh} onNavigate={navigate} onCreate={role === 'admin' ? () => setModalType('course') : undefined} {...shared} />;
  else if (currentPage === 'academic-delivery' && role === 'admin') content = <AcademicDeliveryPage departments={platform.departments} instructors={platform.people.filter((person) => person.role === 'instructor' && person.status === 'active')} onPlatformRefresh={platform.refresh} />;
  else if (currentPage === 'assignments') content = <AssignmentsPage role={role} assignments={platform.assignments} onOpenWorkspace={setWorkspace} onCreate={() => setModalType('assignment')} {...shared} />;
  else if (currentPage === 'practices') content = <PracticesPage role={role} courses={platform.courses} onOpenWorkspace={setPracticeWorkspace} />;
  else if (currentPage === 'student-activity') content = <StudentActivityPage role={role} courses={platform.courses} />;
  else if (currentPage === 'grades') content = <GradesPage assignments={platform.assignments} courses={platform.courses} {...shared} />;
  else if (currentPage === 'academic-structure' && role === 'admin') content = <AcademicStructurePage departments={platform.departments} onRefresh={platform.refresh} {...shared} />;
  else if (currentPage === 'students') content = <PeoplePage admin={role === 'admin'} people={platform.people} departments={platform.departments} onCreate={() => setModalType('user')} onRefresh={platform.refresh} currentUserId={user.id} onCurrentUserUpdated={refreshSession} {...shared} />;
  else if (currentPage === 'settings') content = <SettingsPage user={user} role={role} />;
  else content = null;

  return <div className="app-shell">
    <Header role={role} user={user} courses={platform.courses} assignments={platform.assignments} onNavigate={navigate} onOpenAssignment={setWorkspace} onLogout={logout} onMenuToggle={() => setMenuOpen(true)} />
    <Sidebar role={role} page={currentPage} open={menuOpen} onNavigate={navigate} onClose={() => setMenuOpen(false)} />
    <main className="app-content"><Suspense fallback={<div className="data-state">جارٍ تحميل الصفحة...</div>}>{content}</Suspense></main>
    {modalType ? <CreateModal type={modalType} courses={platform.courses} departments={platform.departments} instructors={platform.people.filter((person) => person.role === 'instructor' && person.status === 'active')} onClose={() => setModalType(null)} onCreated={platform.refresh} /> : null}
  </div>;
}
