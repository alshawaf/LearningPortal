import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export function usePlatformData(role, { includeAssignments = true } = {}) {
  const [data, setData] = useState({ courses: [], catalogCourses: [], assignments: [], people: [], departments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const requests = [apiFetch('/courses'), includeAssignments ? apiFetch('/assignments') : Promise.resolve({ assignments: [] })];
      if (role === 'admin' || role === 'instructor') requests.push(apiFetch('/people'));
      else requests.push(Promise.resolve({ people: [] }));
      if (role === 'admin') requests.push(apiFetch('/academic-structure'));
      else requests.push(Promise.resolve({ departments: [] }));
      if (role === 'admin') requests.push(apiFetch('/courses/catalog'));
      else requests.push(Promise.resolve({ courses: [] }));
      const [courseResult, assignmentResult, peopleResult, structureResult, catalogResult] = await Promise.all(requests);
      setData({
        courses: courseResult.courses,
        catalogCourses: catalogResult.courses,
        assignments: assignmentResult.assignments,
        people: peopleResult?.people ?? [],
        departments: structureResult?.departments ?? [],
      });
    } catch (requestError) {
      setError(requestError.message || 'تعذر تحميل بيانات المنصة.');
    } finally {
      setLoading(false);
    }
  }, [includeAssignments, role]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { ...data, loading, error, refresh };
}
