// Task registry: task type (as sent by the server) -> client module.
// Every module exports default { title, open(container, data, submit), close() }.
//   open:   render the task into `container` using the server's challenge `data`.
//   submit: async (answer) => { result: 'complete' | 'progress' | 'wrong' | 'error', data?, message? }
//           (the overlay closes itself on 'complete'; modules re-render on 'progress' / 'wrong')
//   close:  remove timers / listeners.
// To add a task: create client/tasks/<type>.js, import + register it here, and add a matching
// entry (create/check) to TASKS in server/tasks.js.
import wires from './wires.js';
import simon from './simon.js';
import key from './key.js';
import math from './math.js';
import trivia from './trivia.js';
import codelock from './codelock.js';

export const TASKS = { wires, simon, key, math, trivia, codelock };
