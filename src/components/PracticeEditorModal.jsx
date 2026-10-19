import { ChevronDown, ChevronUp, Eye, EyeOff, PlayCircle, Settings2, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import Select from './Select';
import { offeringLabel } from '../lib/courseLabels';

const blankTest = (input = '', hidden = false) => ({ input, expected: '', isHidden: hidden, timeLimitMs: 2000 });

function splitBulkInputs(value, executionMode) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (executionMode === 'stdin' && /^\s*---\s*$/m.test(value)) {
    return value.split(/^\s*---\s*$/m).map((item) => item.trim()).filter(Boolean);
  }
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function serializeInputs(tests, executionMode) {
  if (!tests?.length) return '';
  return tests.map((test) => test.input).join(executionMode === 'stdin' ? '\n---\n' : '\n');
}

function initialTests(exercise) {
  if (!exercise?.tests?.length) return [];
  return exercise.tests.map((test) => ({
    input: exercise.executionMode === 'stdin' ? test.inputPayload.stdin : JSON.stringify(test.inputPayload.arguments),
    expected: exercise.executionMode === 'stdin' ? test.expectedPayload.stdout : JSON.stringify(test.expectedPayload.return),
    isHidden: test.isHidden,
    timeLimitMs: test.timeLimitMs,
  }));
}

function expectedLabel(output, executionMode) {
  if (!output) return 'لم تُولّد بعد';
  return executionMode === 'stdin' ? output.stdout || 'مخرج فارغ' : JSON.stringify(output.return);
}

export default function PracticeEditorModal({ courses, exercise, onClose, onSaved }) {
  const loadedTests = useMemo(() => initialTests(exercise), [exercise]);
  const [form, setForm] = useState(() => ({
    offeringId: exercise?.offeringId ?? courses[0]?.offeringId ?? '', title: exercise?.title ?? '', description: exercise?.description ?? '',
    executionMode: exercise?.executionMode ?? 'stdin', functionName: exercise?.functionName ?? 'solve', difficulty: exercise?.difficulty ?? 'easy',
    comparisonMode: exercise?.comparisonMode ?? 'auto', ignoreCase: exercise?.ignoreCase ?? false,
    whitespaceMode: exercise?.whitespaceMode ?? 'exact', suppressInputPrompts: exercise?.suppressInputPrompts ?? true,
    points: exercise?.points ?? 10, starterCode: exercise?.starterCode ?? '', referenceSolution: exercise?.referenceSolution ?? '',
  }));
  const [tests, setTests] = useState(loadedTests);
  const [bulkInputs, setBulkInputs] = useState(() => serializeInputs(loadedTests, exercise?.executionMode ?? 'stdin'));
  const [preview, setPreview] = useState(() => loadedTests.map((test) => exercise?.executionMode === 'function'
    ? { return: JSON.parse(test.expected || 'null') }
    : { stdout: test.expected }));
  const [advancedOpen, setAdvancedOpen] = useState(exercise?.comparisonMode === 'flexible');
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const modeOptions = useMemo(() => [{ value: 'stdin', label: 'برنامج عادي باستخدام input و print' }, { value: 'function', label: 'استدعاء دالة' }], []);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const selectComparisonMode = (mode) => setForm((current) => ({
    ...current, comparisonMode: mode, ignoreCase: false, whitespaceMode: 'exact',
  }));
  const toggleWhitespaceRule = (mode) => setForm((current) => ({
    ...current, comparisonMode: 'flexible', whitespaceMode: current.whitespaceMode === mode ? 'exact' : mode,
  }));
  const syncInputs = (value, executionMode = form.executionMode) => {
    setBulkInputs(value);
    setPreview([]);
    const inputs = splitBulkInputs(value, executionMode);
    setTests((current) => inputs.map((input, index) => ({
      ...blankTest(input, index > 0), ...current[index], input,
      isHidden: current[index]?.isHidden ?? index > 0,
    })));
  };
  const switchMode = (mode) => {
    setForm((current) => ({ ...current, executionMode: mode, functionName: mode === 'function' ? current.functionName || 'solve' : null }));
    setBulkInputs(''); setTests([]); setPreview([]);
  };
  const buildTests = () => tests.map((test) => form.executionMode === 'stdin' ? {
    inputPayload: { stdin: test.input.endsWith('\n') ? test.input : `${test.input}\n` },
    expectedPayload: { stdout: test.expected }, isHidden: test.isHidden, timeLimitMs: Number(test.timeLimitMs),
  } : {
    inputPayload: { arguments: JSON.parse(test.input) },
    expectedPayload: { return: test.expected ? JSON.parse(test.expected) : null }, isHidden: test.isHidden, timeLimitMs: Number(test.timeLimitMs),
  });

  const previewOutputs = async () => {
    setError(''); setPreviewing(true);
    try {
      const requestTests = buildTests();
      if (!requestTests.length) throw new Error('أضف مدخلاً واحداً على الأقل لمعاينة النتائج.');
      const result = await apiFetch('/practice/preview', { method: 'POST', body: JSON.stringify({
        executionMode: form.executionMode, functionName: form.executionMode === 'function' ? form.functionName : null,
        referenceSolution: form.referenceSolution, suppressInputPrompts: form.suppressInputPrompts, tests: requestTests,
      }) });
      setPreview(result.outputs);
      setTests((current) => current.map((test, index) => ({ ...test, expected: form.executionMode === 'stdin'
        ? result.outputs[index]?.stdout ?? '' : JSON.stringify(result.outputs[index]?.return) })));
    } catch (caught) {
      setError(caught instanceof SyntaxError ? 'كل حالة في وضع الدالة يجب أن تكون مصفوفة JSON صحيحة.' : caught.message);
    } finally { setPreviewing(false); }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(''); setSaving(true);
    try {
      const parsedTests = buildTests();
      if (parsedTests.length < 2) throw new Error('أضف مدخلين على الأقل؛ ستظهر الحالة الأولى للطالب وتبقى الحالات الأخرى مخفية.');
      if (!parsedTests.some((test) => !test.isHidden) || !parsedTests.some((test) => test.isHidden)) throw new Error('يجب وجود حالة ظاهرة وحالة مخفية واحدة على الأقل.');
      if (form.comparisonMode === 'flexible' && !form.ignoreCase && form.whitespaceMode === 'exact') throw new Error('اختر قاعدة تحقق مرنة واحدة على الأقل.');
      const payload = {
        ...form, points: Number(form.points), functionName: form.executionMode === 'function' ? form.functionName : null,
        autoGenerateExpected: true, tests: parsedTests,
      };
      await apiFetch(exercise ? `/practice/${exercise.id}` : '/practice', { method: exercise ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      await onSaved(); onClose();
    } catch (caught) {
      setError(caught instanceof SyntaxError ? 'كل حالة في وضع الدالة يجب أن تكون مصفوفة JSON صحيحة.' : caught.message);
    } finally { setSaving(false); }
  };

  return <div className="modal-backdrop" role="presentation">
    <section className="modal modal--practice" role="dialog" aria-modal="true" aria-labelledby="practice-editor-title">
      <header><div><h2 id="practice-editor-title">{exercise ? 'تعديل التدريب' : 'إضافة تدريب جديد'}</h2><small>إعداد مبسّط · Python 3.12 · تشغيل معزول</small></div><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X /></button></header>
      <form onSubmit={submit}>
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {exercise?.status === 'published' ? <div className="practice-published-note"><strong>تعديل تدريب منشور</strong><span>سيولّد النظام النتائج من الحل المرجعي ثم ينشئ إصداراً جديداً مع الاحتفاظ بالمحاولات السابقة.</span></div> : null}
        <div className="practice-form-grid">
          <label>الشعبة الدراسية<Select value={form.offeringId} onValueChange={(value) => setField('offeringId', value)} options={courses.map((course) => ({ value: course.offeringId, label: offeringLabel(course) }))} required disabled={exercise?.status === 'published'} /></label>
          <label>عنوان التدريب<input value={form.title} onChange={(event) => setField('title', event.target.value)} required minLength={3} maxLength={180} /></label>
          <label className="practice-form-wide">وصف المسألة والتعليمات<textarea value={form.description} onChange={(event) => setField('description', event.target.value)} required minLength={10} maxLength={20000} /></label>
          <label>طريقة كتابة الحل<Select value={form.executionMode} onValueChange={switchMode} options={modeOptions} /></label>
          {form.executionMode === 'function' ? <label>اسم الدالة<input dir="ltr" value={form.functionName ?? ''} onChange={(event) => setField('functionName', event.target.value)} pattern="[A-Za-z_][A-Za-z0-9_]*" required /></label> : <div className="practice-mode-note"><strong>مناسب للمبتدئين</strong><span>يكتب الطالب برنامجاً طبيعياً باستخدام <code>input</code> و<code>print</code>.</span></div>}
          <label>مستوى الصعوبة<Select value={form.difficulty} onValueChange={(value) => setField('difficulty', value)} options={[{ value: 'easy', label: 'سهل' }, { value: 'medium', label: 'متوسط' }, { value: 'hard', label: 'متقدم' }]} /></label>
          <label>النقاط<input type="number" min="1" max="1000" value={form.points} onChange={(event) => setField('points', event.target.value)} required /></label>
          <label className="practice-form-wide"><span className="field-label">الحل المرجعي <small>(خاص بالأستاذ ولا يظهر للطالب)</small></span><textarea dir="ltr" className="code-field" value={form.referenceSolution} onChange={(event) => { setField('referenceSolution', event.target.value); setPreview([]); }} required spellCheck="false" /></label>

          <section className="practice-smart-setup practice-form-wide">
            <div className="practice-smart-setup__head"><span><Sparkles /></span><div><h3>المدخلات فقط، والباقي على المنصة</h3><p>اكتب كل حالة في سطر. إذا كانت الحالة تتكون من عدة أسطر، افصل بينها بسطر يحتوي <code>---</code>.</p></div></div>
            <label>{form.executionMode === 'stdin' ? 'مدخلات الاختبار' : 'معاملات الدالة — مصفوفة JSON في كل سطر'}<textarea dir="ltr" className="practice-bulk-inputs" value={bulkInputs} onChange={(event) => syncInputs(event.target.value)} placeholder={form.executionMode === 'stdin' ? '7\n14\n50\n-28' : '[7]\n[14]\n[50]'} required /></label>
            <div className="practice-smart-setup__actions"><span>{tests.length} {tests.length === 1 ? 'حالة' : 'حالات'} · الأولى ظاهرة والبقية مخفية</span><button type="button" className="button button--outline" onClick={previewOutputs} disabled={previewing || !form.referenceSolution || !tests.length}><PlayCircle />{previewing ? 'جارٍ تشغيل الحل...' : 'معاينة النتائج'}</button></div>
            {preview.length ? <div className="practice-output-preview"><div><strong>المدخل</strong><strong>الناتج المولّد</strong></div>{tests.map((test, index) => <div key={`${test.input}-${index}`}><code dir="ltr">{test.input}</code><code dir="ltr">{expectedLabel(preview[index], form.executionMode)}</code></div>)}</div> : null}
          </section>

          <fieldset className="practice-comparison practice-form-wide">
            <legend>طريقة التقييم</legend>
            <div className="practice-comparison__modes">
              <label className={form.comparisonMode === 'auto' ? 'is-selected' : ''}>
                <input type="radio" name="comparisonMode" value="auto" checked={form.comparisonMode === 'auto'} onChange={() => selectComparisonMode('auto')} />
                <Sparkles /><span><strong>تقييم ذكي — موصى به</strong><small>يكتشف الأعداد والتصنيفات والنصوص تلقائياً ويتجاوز اختلافات التنسيق غير المؤثرة.</small></span>
              </label>
              <label className={form.comparisonMode === 'exact' ? 'is-selected' : ''}>
                <input type="radio" name="comparisonMode" value="exact" checked={form.comparisonMode === 'exact'} onChange={() => selectComparisonMode('exact')} />
                <Eye /><span><strong>مطابقة تامة</strong><small>استخدمها فقط عندما يكون شكل المخرجات جزءاً مطلوباً من السؤال.</small></span>
              </label>
            </div>
          </fieldset>
        </div>

        <button type="button" className={`practice-advanced-toggle ${advancedOpen ? 'is-open' : ''}`} onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen}><Settings2 /><span><strong>إعدادات متقدمة</strong><small>قواعد يدوية، الشفرة الابتدائية، وخصائص حالات الاختبار</small></span>{advancedOpen ? <ChevronUp /> : <ChevronDown />}</button>
        {advancedOpen ? <section className="practice-advanced-panel">
          <div className="practice-advanced-panel__grid">
            <label className="practice-prompt-option"><input type="checkbox" checked={form.suppressInputPrompts} onChange={(event) => setField('suppressInputPrompts', event.target.checked)} /><span><strong>تجاهل رسائل طلب الإدخال</strong><small>لا تؤثر عبارة مثل <code>input(&quot;أدخل الرقم&quot;)</code> في النتيجة.</small></span></label>
            <button type="button" className={`practice-manual-mode ${form.comparisonMode === 'flexible' ? 'is-selected' : ''}`} onClick={() => setForm((current) => ({ ...current, comparisonMode: 'flexible' }))}><Settings2 /><span><strong>قواعد تحقق يدوية</strong><small>للحالات الخاصة التي لا يناسبها التقييم الذكي.</small></span></button>
          </div>
          {form.comparisonMode === 'flexible' ? <div className="practice-comparison__rules">
            <p>قواعد التحقق اليدوي <small>اختر قاعدة واحدة على الأقل</small></p>
            <label className={form.ignoreCase ? 'is-checked' : ''}><input type="checkbox" checked={form.ignoreCase} onChange={(event) => setForm((current) => ({ ...current, ignoreCase: event.target.checked }))} /><span><strong>تجاهل حالة الأحرف</strong><small>يعامل الأحرف الكبيرة والصغيرة بالتساوي.</small></span></label>
            <label className={form.whitespaceMode === 'normalize' ? 'is-checked' : ''}><input type="checkbox" checked={form.whitespaceMode === 'normalize'} onChange={() => toggleWhitespaceRule('normalize')} /><span><strong>توحيد المسافات والأسطر</strong><small>يبقي حدود الكلمات ويزيل اختلاف التنسيق.</small></span></label>
            <label className={form.whitespaceMode === 'remove' ? 'is-checked' : ''}><input type="checkbox" checked={form.whitespaceMode === 'remove'} onChange={() => toggleWhitespaceRule('remove')} /><span><strong>تجاهل جميع المسافات</strong><small>يعالج التصاق الكلمات مثل <code>aMultiple</code>.</small></span></label>
          </div> : null}
          <label className="practice-starter-code"><span className="field-label">الشفرة الابتدائية <small>(اختيارية)</small></span><textarea dir="ltr" className="code-field" value={form.starterCode} onChange={(event) => setField('starterCode', event.target.value)} spellCheck="false" /></label>
          {tests.length ? <div className="practice-case-settings"><h3>خصائص الحالات</h3>{tests.map((test, index) => <div key={`${test.input}-${index}`}><code dir="ltr">{test.input}</code><button type="button" className={`test-visibility ${test.isHidden ? 'is-hidden' : ''}`} onClick={() => setTests((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, isHidden: !item.isHidden } : item))}>{test.isHidden ? <EyeOff /> : <Eye />}{test.isHidden ? 'مخفية' : 'ظاهرة'}</button><label>الوقت<input type="number" min="100" max="10000" value={test.timeLimitMs} onChange={(event) => setTests((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, timeLimitMs: event.target.value } : item))} /></label></div>)}</div> : null}
        </section> : null}
        <footer><button type="button" className="button button--outline" onClick={onClose}>إلغاء</button><button className="button button--primary" disabled={saving || !courses.length}>{saving ? 'جارٍ توليد النتائج والحفظ...' : exercise?.status === 'published' ? 'تحقق واحفظ الإصدار' : 'حفظ المسودة'}</button></footer>
      </form>
    </section>
  </div>;
}
