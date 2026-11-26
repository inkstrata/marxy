// The question page's behaviour. Runs after ask-answers.mjs's functions are defined in the same script.
// Served: every change is saved to the command serving the page, and Send ends it. Opened as a file: answers
// stay in this browser, and Copy or Save takes them out.
(() => {
  const data = JSON.parse(document.getElementById('marxy-ask-data').textContent);
  const set = { title: data.title, questions: data.questions };
  const key = `marxy-ask:${data.name}`;
  const progress = document.querySelector('.marxy-ask-progress');
  const savedNote = document.querySelector('.marxy-ask-saved');
  let state = { answers: {}, sent: false };

  const light = window.matchMedia('(prefers-color-scheme: light)');
  const scheme = () => {
    if (light.matches) document.documentElement.dataset.marxyVariant = 'light';
    else delete document.documentElement.dataset.marxyVariant;
  };
  scheme();
  light.addEventListener('change', scheme);

  function stored() {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  // A served page starts from the answers on disk. A file page takes the newer of what this browser kept and
  // what was on disk when the page was built, so an answers file imported later is not hidden by an old visit.
  const kept = stored();
  const start = data.served || !kept ? data.answers : !data.answers || (kept.saved ?? '') >= (data.answers.saved ?? '') ? kept : data.answers;
  if (start?.answers) state = { answers: start.answers, sent: Boolean(start.sent), saved: start.saved ?? null };
  let closed = false;

  const sections = [...document.querySelectorAll('.marxy-ask-q')];

  function fill() {
    for (const sec of sections) {
      const a = state.answers[sec.dataset.q] ?? {};
      for (const input of sec.querySelectorAll('input[value]')) input.checked = (a.picked ?? []).includes(input.value);
      for (const t of sec.querySelectorAll('textarea[data-specify]')) t.value = a.specify?.[t.dataset.specify] ?? '';
      sec.querySelector('textarea[data-note]').value = a.note ?? '';
    }
  }

  function readSection(sec) {
    const picked = [...sec.querySelectorAll('input[value]:checked')].map(i => i.value);
    const specify = {};
    for (const t of sec.querySelectorAll('textarea[data-specify]')) if (t.value.trim()) specify[t.dataset.specify] = t.value;
    const note = sec.querySelector('textarea[data-note]').value;
    return { picked, specify, note };
  }

  function show() {
    for (const sec of sections) {
      for (const choice of sec.querySelectorAll('.marxy-ask-choice')) {
        const box = choice.querySelector('.marxy-ask-specify');
        if (box) box.hidden = !choice.querySelector('input').checked;
      }
      const done = isAnswered(state.answers[sec.dataset.q]);
      sec.toggleAttribute('data-answered', done);
      sec.querySelector('.marxy-ask-state').textContent = done ? 'Answered' : '';
    }
    const n = answeredCount(set.questions, state.answers);
    progress.textContent = `${n} of ${set.questions.length} answered${state.sent ? ', sent' : ''}`;
  }

  let timer = 0;
  async function save(sent = false) {
    if (closed) {
      savedNote.textContent = 'Already sent, so this page no longer saves. Copy answers keeps later changes.';
      return false;
    }
    if (sent) state.sent = true;
    state.saved = new Date().toISOString();
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
    if (!data.served) {
      savedNote.textContent = 'Kept in this browser';
      return true;
    }
    try {
      const r = await fetch(sent ? '/send' : '/answers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) });
      if (!r.ok) throw new Error(await r.text());
      savedNote.textContent = sent ? 'Sent. You can close this page.' : `Saved ${new Date().toLocaleTimeString()}`;
      if (sent) closed = true;
      return true;
    } catch (e) {
      if (sent) state.sent = false;
      savedNote.textContent = `Not saved: ${e.message || 'the command serving this page has stopped'}. Copy answers keeps them.`;
      return false;
    }
  }

  function changed(sec) {
    state.answers[sec.dataset.q] = readSection(sec);
    state.sent = false;
    show();
    clearTimeout(timer);
    timer = setTimeout(() => save(), 400);
  }

  for (const sec of sections) {
    sec.addEventListener('input', () => changed(sec));
    sec.addEventListener('change', () => changed(sec));
  }

  const markdown = () => answersMarkdown(set, { ...state, saved: new Date().toISOString() });

  document.querySelector('.marxy-ask-foot').addEventListener('click', async e => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(markdown());
        savedNote.textContent = 'Answers copied as Markdown';
      } catch {
        savedNote.textContent = 'The browser refused the clipboard';
      }
    } else if (act === 'save') {
      const blob = new Blob([JSON.stringify({ ...state, saved: new Date().toISOString() }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${data.name}-answers.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      savedNote.textContent = `Saved ${a.download}: pnpm work ask read ${data.name} --from <that file>`;
    } else if (act === 'send') {
      const missing = set.questions.length - answeredCount(set.questions, state.answers);
      // A cancel leaves a pending save to run, so an edit just before Send is not lost.
      if (missing && !window.confirm(`${missing} question${missing === 1 ? ' is' : 's are'} not answered. Send anyway?`)) return;
      clearTimeout(timer);
      e.target.disabled = true;
      if (!(await save(true))) e.target.disabled = false;
      show();
    }
  });

  fill();
  show();
})();
