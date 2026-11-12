import { faFolder } from "@awesome.me/kit-2e791c163e/icons/sharp/regular";
import type { FileTree, FileTreeIconConfig } from "@pierre/trees";
import { FILE_ICON_SET } from "#/lib/file-icons";

/**
 * Shared look for every `@pierre/trees` tree. Colours and row states come from
 * the `file-tree-container` block in globals.css (per `data-tree` variant), so
 * theme switches stay pure CSS; this module only carries geometry and glyphs.
 */

export const TREE_ROW_HEIGHT = 28;

const CHEVRON_SYMBOL = "geld-tree-chevron";

/** A sharp-tipped chevron, pointing down. */
const SPRITE_SHEET = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="${CHEVRON_SYMBOL}" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="miter"/></symbol></svg>`;

export const TREE_ICONS: FileTreeIconConfig = {
	set: FILE_ICON_SET,
	colored: true,
	spriteSheet: SPRITE_SHEET,
	remap: {
		"file-tree-icon-chevron": { name: CHEVRON_SYMBOL, width: 12, height: 12 },
	},
};

const [FOLDER_WIDTH, FOLDER_HEIGHT, , , FOLDER_DATA] = faFolder.icon;
const FOLDER_PATHS =
	typeof FOLDER_DATA === "string" ? [FOLDER_DATA] : FOLDER_DATA;

/** The folder glyph the rest of the app uses, drawn as a mask. */
const FOLDER_MASK = `url("data:image/svg+xml,${encodeURIComponent(
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FOLDER_WIDTH} ${FOLDER_HEIGHT}">${FOLDER_PATHS.map((d) => `<path d="${d}"/>`).join("")}</svg>`,
)}")`;

/**
 * Rows are laid out like the trees they replace: a chevron lane, our
 * folder glyph before folder names, file icons aligned under folder glyphs,
 * 12px per level and no indent guides.
 */
export const TREE_UNSAFE_CSS = `
[data-type='item'] {
	padding: 0 8px 0 6px;
	border-bottom: var(--tree-row-gap, 0px) solid transparent;
	background-clip: padding-box;
	transition: background-color 120ms, color 120ms;
}
[data-type='item']:hover {
	color: var(--tree-hover-fg, inherit);
}
[data-item-section='spacing'] {
	padding-left: 0;
	margin-inline-end: calc(-1 * var(--trees-item-row-gap));
}
[data-item-section='spacing-item'] {
	width: 12px;
	margin: 0;
	border: 0;
}
[data-item-section='spacing-item'] + [data-item-section='spacing-item'] {
	margin-left: 0;
}
[data-item-type='folder'] > [data-item-section='icon'] {
	width: var(--tree-chevron-lane, 12px);
	color: var(--tree-chevron-fg, currentColor);
}
[data-item-type='file'] > [data-item-section='icon'] {
	width: var(--tree-file-icon-size, 16px);
	margin-inline-start: calc(var(--tree-chevron-lane, 12px) + 6px);
}
[data-item-type='file'] > [data-item-section='icon'] svg {
	width: var(--tree-file-icon-size, 16px);
	height: var(--tree-file-icon-size, 16px);
}
[data-item-type='folder'] > [data-item-section='content'] {
	display: flex;
	align-items: center;
}
[data-item-type='folder'] > [data-item-section='content'] > * {
	min-width: 0;
}
[data-item-type='folder'] > [data-item-section='content']::before {
	content: '';
	flex: none;
	width: var(--tree-file-icon-size, 16px);
	height: var(--tree-file-icon-size, 16px);
	margin-inline-end: 6px;
	background-color: var(--tree-folder-fg, currentColor);
	mask: ${FOLDER_MASK} center / contain no-repeat;
}
[data-item-flattened-subitems] {
	gap: 0;
}
[data-item-section='decoration'] {
	padding-left: 8px;
	font-size: 11px;
	font-weight: 450;
	font-variant-numeric: tabular-nums;
}
[data-item-contains-git-change='true'] > [data-item-section='git'],
[data-item-section='git'] {
	display: none;
}
[data-item-git-status='deleted'] > [data-item-section='content'] {
	text-decoration: line-through;
}
`;

/**
 * Re-renders visible rows so `renderRowDecoration` sees state the model does
 * not own (e.g. a directory that started or failed loading).
 */
export function refreshTreeRows(model: FileTree) {
	model.setComposition(model.getComposition());
}

/** The row path under a pointer event that crossed the tree's shadow root. */
export function treeRowPathFromEvent(event: Event): string | null {
	for (const target of event.composedPath()) {
		if (target instanceof HTMLElement && target.dataset.type === "item") {
			return target.dataset.itemPath ?? null;
		}
	}
	return null;
}
