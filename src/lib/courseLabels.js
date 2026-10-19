export function offeringContext(item) {
  return [item.termName, item.sectionCode ? `الشعبة ${item.sectionCode}` : null].filter(Boolean).join(' · ');
}

export function offeringLabel(item) {
  const context = offeringContext(item);
  return `${item.code ?? item.courseCode ?? ''} — ${item.title ?? item.courseTitle ?? ''}${context ? ` · ${context}` : ''}`;
}
