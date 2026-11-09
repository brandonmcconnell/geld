// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { regionsOf } from './regions';

/** The records a real observer sees when `target` toggles `hidden`, as GitHub's file filter does. */
function hiddenToggled(target: HTMLElement): MutationRecord[] {
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  target.hidden = !target.hidden;
  const records = observer.takeRecords();
  observer.disconnect();
  return records;
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`fixture: #${id}`);
  return element;
}

describe('regionsOf', () => {
  it("counts the classic files view's tree as files, though it sits in a .Layout-sidebar", () => {
    document.body.innerHTML = `
      <div id="files_bucket"><div class="Layout-sidebar diff-sidebar"><file-tree><ul role="tree"><li id="item"></li></ul></file-tree></div></div>`;
    expect([...regionsOf(hiddenToggled(byId('item')))]).toEqual(['files']);
  });

  it("still counts the pull request's own sidebar as conversation", () => {
    document.body.innerHTML = `<div class="Layout-sidebar"><div id="reviewers"></div></div>`;
    expect([...regionsOf(hiddenToggled(byId('reviewers')))]).toEqual(['conversation']);
  });
});
