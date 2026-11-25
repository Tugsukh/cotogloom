// Server-side task registry. Each task type creates a challenge and checks answers, so clients
// can't fake completion. To add a task type: add an entry here AND a client module in client/tasks/
// registered in client/tasks/index.js under the same key.
//
//   create(ctx)               -> { data, secret }   data is sent to the client, secret never leaves the server
//   check(task, answer, ctx)  -> { result: 'complete' }
//                              | { result: 'progress', data }        (multi-step tasks)
//                              | { result: 'wrong', data, message }  (data = fresh challenge, if any)
// ctx = { station }  where station = { id, type, code }
import fs from 'fs';

const rnd = (n) => Math.floor(Math.random() * n);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------- trivia questions (shared file)
const QUESTIONS_FILE = new URL('../client/tasks/questions.json', import.meta.url);
export let QUESTIONS = [];
export function loadQuestions() {
  const raw = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
  QUESTIONS = raw.filter((q) => q && typeof q.q === 'string' && Array.isArray(q.choices) && q.choices.length >= 2 &&
    Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length);
  if (QUESTIONS.length < 2) throw new Error('questions.json needs at least 2 valid questions');
  return QUESTIONS.length;
}
loadQuestions();

function triviaRound() {
  return shuffle(QUESTIONS).slice(0, 2).map((q) => {
    const order = shuffle(q.choices.map((_, i) => i));
    return { q: q.q, choices: order.map((i) => q.choices[i]), answer: order.indexOf(q.answer) };
  });
}

function mathQuestion() {
  const kind = rnd(4);
  let a, b, text, answer;
  if (kind === 0) { a = 10 + rnd(80); b = 10 + rnd(80); text = `${a} + ${b}`; answer = a + b; }
  else if (kind === 1) { a = 30 + rnd(70); b = 5 + rnd(a - 5); text = `${a} − ${b}`; answer = a - b; }
  else if (kind === 2) { a = 2 + rnd(11); b = 2 + rnd(11); text = `${a} × ${b}`; answer = a * b; }
  else { b = 2 + rnd(9); answer = 2 + rnd(11); a = b * answer; text = `${a} ÷ ${b}`; }
  return { text, answer };
}

function makeKey() { return { bow: rnd(3), teeth: Array.from({ length: 5 }, () => 1 + rnd(3)) }; }
const keyId = (k) => k.bow + ':' + k.teeth.join('');

export const WIRE_COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'orange'];

export const TASKS = {
  wires: {
    create() {
      const colors = shuffle(WIRE_COLORS).slice(0, 4);
      const left = shuffle(colors), right = shuffle(colors);
      return { data: { left, right }, secret: { left, right } };
    },
    // answer: array, answer[i] = index on the right connected to left wire i
    check(task, answer) {
      const { left, right } = task.secret;
      const ok = Array.isArray(answer) && answer.length === 4 && new Set(answer).size === 4 &&
        answer.every((ri, li) => Number.isInteger(ri) && right[ri] === left[li]);
      if (ok) return { result: 'complete' };
      Object.assign(task, this.create());
      return { result: 'wrong', data: task.data, message: 'Sparks! Wrong wiring — new panel.' };
    },
  },

  simon: {
    create() {
      const sequence = Array.from({ length: 5 }, () => rnd(4));
      return { data: { sequence }, secret: { sequence } };
    },
    check(task, answer) {
      if (same(answer, task.secret.sequence)) return { result: 'complete' };
      Object.assign(task, this.create());
      return { result: 'wrong', data: task.data, message: 'Wrong pattern — watch the new one.' };
    },
  },

  key: {
    create() {
      const opts = new Map();
      while (opts.size < 6) { const k = makeKey(); opts.set(keyId(k), k); }
      const options = [...opts.values()];
      const answer = rnd(6);
      return { data: { target: options[answer], options }, secret: { answer } };
    },
    check(task, answer) {
      if (answer === task.secret.answer) return { result: 'complete' };
      Object.assign(task, this.create());
      return { result: 'wrong', data: task.data, message: 'That key doesn\'t fit — the lock changed.' };
    },
  },

  math: {
    create() {
      const questions = [mathQuestion(), mathQuestion(), mathQuestion()];
      return { data: { question: questions[0].text, index: 0, total: 3 }, secret: { questions, index: 0 } };
    },
    // answer: number for the current question
    check(task, answer) {
      const sec = task.secret;
      const q = sec.questions[sec.index];
      if (answer !== null && answer !== '' && Number(answer) === q.answer) {
        sec.index++;
        if (sec.index >= sec.questions.length) return { result: 'complete' };
        task.data = { question: sec.questions[sec.index].text, index: sec.index, total: 3 };
        return { result: 'progress', data: task.data };
      }
      Object.assign(task, this.create());
      return { result: 'wrong', data: task.data, message: 'Wrong! New questions — start over.' };
    },
  },

  trivia: {
    create() {
      const qs = triviaRound();
      return { data: { question: qs[0].q, choices: qs[0].choices, index: 0, total: qs.length }, secret: { qs, index: 0 } };
    },
    // answer: index of the chosen option for the current question
    check(task, answer) {
      const sec = task.secret;
      if (answer === sec.qs[sec.index].answer) {
        sec.index++;
        if (sec.index >= sec.qs.length) return { result: 'complete' };
        const q = sec.qs[sec.index];
        task.data = { question: q.q, choices: q.choices, index: sec.index, total: sec.qs.length };
        return { result: 'progress', data: task.data };
      }
      const fresh = this.create();
      task.data = fresh.data; task.secret = fresh.secret;
      return { result: 'wrong', data: task.data, message: 'Wrong answer — new questions.' };
    },
  },

  codelock: {
    create() {
      return { data: { length: 4, hint: 'The code is painted on a sign somewhere near this station.' }, secret: {} };
    },
    // answer: string of digits; the code belongs to the station (it's drawn in the 3D world)
    check(task, answer, ctx) {
      if (String(answer) === ctx.station.code) return { result: 'complete' };
      return { result: 'wrong', data: task.data, message: 'Wrong code.' };
    },
  },
};

export const TASK_TYPES = Object.keys(TASKS);

export function randomCode() { return String(rnd(10000)).padStart(4, '0'); }

/** Assign a task type to every station: a shuffled bag so every type appears when there are enough stations. */
export function rollStationTasks(stations) {
  let bag = [];
  return stations.map((s) => {
    if (!bag.length) bag = shuffle(TASK_TYPES);
    const type = bag.pop();
    return { id: s.id, type, code: type === 'codelock' ? randomCode() : null };
  });
}
