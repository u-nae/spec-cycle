// Identifier matching shared by check-plan and verify: an id matches only as a whole token.
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function idPattern(id) {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(id)}(?![A-Za-z0-9_-])`);
}

function containsId(text, id) {
  return idPattern(id).test(String(text));
}

export { containsId, idPattern, escapeRegExp };
