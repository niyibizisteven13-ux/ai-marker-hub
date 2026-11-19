'use strict';
function permitted(raw, policy) {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (policy.mode === 'open' || policy.origins.includes(url.origin))
    );
  } catch {
    return false;
  }
}
module.exports = { permitted };
