import assert from 'node:assert/strict';

const styles = [
  ['Sharp Regular', 'sharp/regular', ['faFolder', 'faComment', 'faComments', 'faLock', 'faCodePullRequest']],
  ['Sharp Solid', 'sharp/solid', ['faFolder', 'faComment', 'faComments', 'faLock', 'faCodePullRequest']],
  ['Utility', 'utility/semibold', ['faFolder', 'faComment', 'faComments', 'faLock']],
  ['Utility Fill', 'utility-fill/semibold', ['faFolder', 'faComment', 'faComments', 'faLock']],
];

for (const [name, path, required] of styles) {
  const icons = await import(`@awesome.me/kit-2e791c163e/icons/${path}`);
  for (const key of required) {
    const definition = icons[key];
    assert.ok(definition && Array.isArray(definition.icon), `${name} is missing ${key}`);
    assert.equal(definition.icon.length, 5, `${name} has invalid data for ${key}`);
    assert.ok(definition.icon[4].length, `${name} has no path data for ${key}`);
  }
  console.log(`${name}: ${required.length} required icons verified`);
}
