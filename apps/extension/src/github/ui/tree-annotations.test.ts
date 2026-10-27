// @vitest-environment happy-dom
import { categoryById } from '@geld/core/categories';
import { trailingVisualOf } from '../views/react';
import { renderTreeSection } from './tree-section';

const WARNING = `
  <li role="treeitem" aria-label="about-mintlify.mdx has warning annotations" id="about-mintlify.mdx">
    <div class="PRIVATE_TreeView-item-container">
      <div class="PRIVATE_TreeView-item-content">
        <div class="PRIVATE_TreeView-item-visual"><svg class="octicon octicon-file-added fgColor-success"></svg></div>
        <span class="PRIVATE_TreeView-item-content-text">about-mintlify.mdx</span>
        <div class="PRIVATE_TreeView-item-visual">
          <div class="d-flex flex-items-center flex-row">
            <svg class="octicon octicon-comment"></svg>
            <div class="ml-1 text-bold fgColor-default f6">2</div>
            <div class="pl-1 fgColor-attention"><svg class="octicon octicon-alert"></svg></div>
          </div>
        </div>
      </div>
    </div>
  </li>`;

describe('a hidden file keeps the tree row\'s trailing marks', () => {
  it('clones the comment count and the annotation icon with their colours', () => {
    document.body.innerHTML = `<ul id="tree">${WARNING}</ul>`;
    const item = document.querySelector('li');
    if (!(item instanceof HTMLElement)) throw new Error('fixture');
    const trailing = trailingVisualOf(item.querySelectorAll(':scope > [class*="item-container"] [class*="item-content"] > [class*="item-visual"]'));
    if (trailing === null) throw new Error('no trailing visual');
    // A row with only its status icon has nothing trailing.
    expect(trailingVisualOf(item.querySelectorAll('[class*="item-visual"]:first-child'))).toBeNull();
    const tree = document.getElementById('tree');
    if (!(tree instanceof HTMLElement)) throw new Error('tree');
    const section = renderTreeSection(
      tree,
      {
        category: categoryById('tests'),
        view: 'react',
        stateKey: 'acme/widgets/pull/1',
        active: true,
        files: [{ path: 'about-mintlify.mdx', available: true, statusIcon: null, status: null, trailingVisual: trailing, annotationLabel: item.getAttribute('aria-label') }],
      },
      () => undefined,
      () => undefined,
    );
    const row = section.querySelector('.geld-tree__row[data-path="about-mintlify.mdx"]');
    const marks = row?.querySelector('.geld-tree__trailing');
    expect(marks?.getAttribute('aria-hidden')).toBe('true');
    expect(marks?.querySelector('.octicon-comment')).not.toBeNull();
    expect(marks?.querySelector('.fgColor-attention .octicon-alert')).not.toBeNull();
    expect(marks?.textContent).toContain('2');
    expect(row?.getAttribute('aria-label')).toBe('about-mintlify.mdx has warning annotations');
    // The leading status icon is not what got copied into the trailing slot.
    expect(marks?.querySelector('.octicon-file-added')).toBeNull();
  });
});
