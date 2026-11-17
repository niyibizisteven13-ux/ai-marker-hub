'use strict';
/**
 * A short message from the teacher (or their assistant) rides on the heartbeat answer as { notice: { id, text } }.
 * This reads it without trusting the shape and returns what to show, once per notice id. Pure, so it can be tested.
 */
function pickNotice(json, lastId) {
  const n = json && typeof json === 'object' ? json.notice : null;
  if (!n || typeof n !== 'object' || typeof n.id !== 'string' || typeof n.text !== 'string') return null;
  const text = n.text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300);
  if (!text || n.id === lastId) return null;
  return { id: n.id.slice(0, 40), title: 'Message from your teacher', text };
}
module.exports = { pickNotice };
