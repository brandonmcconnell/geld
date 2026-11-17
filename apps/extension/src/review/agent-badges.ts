/** A review bot's own badges inside its comment, on every host: read where they stand, hidden there, and worn by Geld's byline. */

/**
 * Re-trigger controls review bots put inside their own comments: hidden in
 * the chat, where Geld's Rerun stands for them (one control, one behaviour,
 * the request menu's). Each is a markdown badge link, so the heading or
 * paragraph that holds only it goes too. The nodes are GitHub's and go home
 * untouched: the hiding is a mark the chat's own CSS reads.
 */
const AGENT_RERUN_CONTROLS = ['a[href*="app.greptile.com/api/retrigger"]'];
const ATTR_AGENT_RERUN = 'data-geld-agent-rerun';
/**
 * A bot's own "view this run on our site" badge inside its comment (Greptile's
 * "View in Greptile", Devin's "Devin Review", CodeRabbit's "Review in Change
 * Stack" — each a linked image, present only when the bot chose to show it).
 * A review posted by a Cursor cloud agent (an automation, by `cursor[bot]`)
 * ends in "Open in Web", the agent's run on cursor.com. Found Oct 2026 on
 * public pull requests; Bugbot's "Fix All in Cursor" is an action, not a
 * view, and the other bots post none. Since Nov 2026 Greptile's badge goes
 * through its tenant switch, the run's path encoded in `next`
 * (`/-/switch-tenant?tenant=o&next=%2Fo%2Fr%2Fpull%2F9`).
 */
const AGENT_VIEW_LINKS = [
  'a[href^="https://app.greptile.com/"][href*="/pull/"]:not([href*="/api/retrigger"])',
  'a[href^="https://app.greptile.com/-/switch-tenant?"][href*="%2Fpull%2F"]',
  'a[href^="https://app.devin.ai/review/"]',
  'a[href^="https://app.coderabbit.ai/change-stack/"]',
  'a[href^="https://cursor.com/agents/"]',
];
const ATTR_AGENT_VIEW = 'data-geld-agent-view';

export function hideAgentRerunControls(body: HTMLElement): void {
  for (const link of body.querySelectorAll<HTMLElement>(AGENT_RERUN_CONTROLS.join(', '))) hideAgentBadge(link, ATTR_AGENT_RERUN);
}

/**
 * Hide a bot's badge where it stands, and the block holding it once it holds
 * nothing else that shows (Greptile's badges share one paragraph with a
 * `<br clear="all">`: with both badges gone the paragraph is a blank line).
 */
function hideAgentBadge(link: HTMLElement, attribute: string): void {
  link.setAttribute(attribute, '');
  const holder = link.closest<HTMLElement>('h1, h2, h3, h4, p, div');
  if (holder === null || (holder.textContent ?? '').trim() !== '') return;
  const showing = [...holder.querySelectorAll('a, img')].some((node) => node.closest(`[${ATTR_AGENT_RERUN}], [${ATTR_AGENT_VIEW}]`) === null);
  if (!showing) holder.setAttribute(ATTR_AGENT_RERUN, '');
}

/** What a bot's view badge links to, for the byline's View control. */
export interface AgentViewLink {
  readonly href: string;
  /** The badge's words: "View in Greptile", "Devin Review". */
  readonly label: string;
}

/** The bot's view badge in its comment, hidden there and handed back so the byline can wear it as View. Exported for its test. */
export function takeAgentViewLink(body: HTMLElement): AgentViewLink | null {
  // The badge is a linked image on the run's own path; a text link to the same site earlier in the comment (a
  // settings or support link) is neither, and stays where it is.
  const link = [...body.querySelectorAll<HTMLAnchorElement>(AGENT_VIEW_LINKS.join(', '))].find((candidate) => candidate.querySelector('img') !== null) ?? null;
  if (link === null) return null;
  hideAgentBadge(link, ATTR_AGENT_VIEW);
  const words = (link.querySelector('img')?.getAttribute('alt') ?? link.textContent ?? '').replace(/\s*(?:\u2192|->)\s*$/, '').replace(/\s+/g, ' ').trim();
  return { href: link.href, label: words };
}
