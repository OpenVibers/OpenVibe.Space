// functions/check.js runs on the server, so the answers below never reach a visitor's browser (try View Source).
// The page asks with OV.fn('check', { id, answer }) and gets back { right, solved }.
const ANSWERS = {
  sun: ['mercury'],
  moon: ['1969'],
  ocean: ['pacific', 'pacific ocean', 'the pacific'],
  bones: ['206'],
  hearts: ['3', 'three'],
};

async function handle(request, ov) {
  if (request.method !== 'POST') return { questions: Object.keys(ANSWERS).length };
  const { id, answer } = request.body || {};
  if (!Object.prototype.hasOwnProperty.call(ANSWERS, id)) return { status: 400, body: { error: 'unknown question' } };
  const guess = String(answer || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const right = ANSWERS[id].includes(guess);
  // How many right answers each question has had, kept in the space's own server storage.
  const key = 'solved-' + id;
  let solved = (await ov.store.get(key)) || 0;
  if (right) { solved += 1; await ov.store.set(key, solved); }
  console.log(id, right ? 'right' : 'wrong');
  return { right, solved };
}
