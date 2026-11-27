// Answers to a question set, as Markdown. The question page inlines this file's source with `export`
// removed, so it is plain JavaScript with no imports: the page's Copy and the command line write the same text.

/** How many questions have an answer: a choice picked, or a note written. */
export function answeredCount(questions, answers) {
  return questions.filter(q => isAnswered(answers?.[q.id])).length;
}

export function isAnswered(a) {
  return Boolean(a && ((a.picked && a.picked.length) || (a.note && a.note.trim())));
}

/** The answers as Markdown: one `##` per question with what was picked, what was written against it, and the note. */
export function answersMarkdown(set, answers) {
  const all = answers?.answers ?? {};
  const qs = set.questions;
  const lines = [`# Answers: ${set.title}`, ''];
  const state = answers?.sent ? 'sent' : 'not sent yet';
  lines.push(`${answeredCount(qs, all)} of ${qs.length} answered, ${state}${answers?.saved ? `, saved ${answers.saved}` : ''}.`, '');
  for (const q of qs) {
    const a = all[q.id] ?? {};
    lines.push(`## ${q.id}: ${q.title.replace(/\s+/g, ' ').trim()}`, '');
    if (!isAnswered(a)) {
      lines.push(q.default ? `Not answered. Default: ${q.default}` : 'Not answered.', '');
      continue;
    }
    for (const id of a.picked ?? []) {
      const c = (q.choices ?? []).find(x => x.id === id);
      lines.push(`- Picked: ${c ? c.label : id} (\`${id}\`)`);
      const said = a.specify?.[id]?.trim();
      if (said) lines.push(`  - ${c?.specify ?? 'Specified'}: ${said.replace(/\s*\n\s*/g, ' / ')}`);
    }
    const note = a.note?.trim();
    if (note) {
      if (a.picked?.length) lines.push('');
      lines.push(...note.split(/\r?\n/).map(l => `> ${l}`));
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
