import { browser } from 'wxt/browser';
import { connectionFrom, resolverFor, type Connection, type ConnectionDraft, type ConnectionUse } from '@geld/review/link-resolvers/index';
import { splitInlineCode } from '@geld/core';
import { hasOrigins, readConnections, requestOrigins, watchConnections, writeConnections } from '../../src/lib/connections';
import { APP_SERVICES, KEY_SERVICES, type AppServiceSpec, type ServiceSpec } from '../../src/lib/connection-services';
import type { AppConnectResult } from '../../src/lib/app-connect';
import { connectSlack, revokeSlack, SLACK_CLIENT_ID, SLACK_ORIGINS } from '../../src/lib/slack-connect';
import { connectTeams, TEAMS_CLIENT_ID, TEAMS_ORIGINS } from '../../src/lib/teams-connect';
import { connectDiscord, DISCORD_CLIENT_ID, DISCORD_ORIGINS, discordBotInviteUrl, revokeDiscord } from '../../src/lib/discord-connect';
import { DISCORD_BOT_PERMISSIONS } from '@geld/review/link-resolvers/index';

/** How each app service signs in: whether this build has its app, the origins to ask for, the flow and its sign-out. */
interface AppFlow {
  readonly ready: boolean;
  readonly origins: readonly string[];
  readonly connect: (existing: readonly Connection[]) => Promise<AppConnectResult>;
  readonly revoke: (connection: Connection) => Promise<void>;
  /** A line under the service's blurb, such as where a server admin adds Geld's bot. */
  readonly note?: () => readonly Node[];
}

const APP_FLOWS: Partial<Record<Connection['service'], AppFlow>> = {
  slack: { ready: SLACK_CLIENT_ID !== '', origins: SLACK_ORIGINS, connect: connectSlack, revoke: (connection) => revokeSlack(connection.secret) },
  // Microsoft has no call to revoke one token; removing the connection deletes it here, and the reader can sign Geld out under My Apps.
  teams: { ready: TEAMS_CLIENT_ID !== '', origins: TEAMS_ORIGINS, connect: connectTeams, revoke: async () => undefined },
  discord: {
    ready: DISCORD_CLIENT_ID !== '',
    origins: DISCORD_ORIGINS,
    connect: connectDiscord,
    revoke: revokeDiscord,
    note: () => {
      const invite = document.createElement('a');
      invite.href = discordBotInviteUrl(DISCORD_CLIENT_ID, DISCORD_BOT_PERMISSIONS);
      invite.target = '_blank';
      invite.rel = 'noreferrer';
      invite.textContent = 'add Geld’s bot';
      return [document.createTextNode('A server admin needs to '), invite, document.createTextNode(' to each server first. It can only see channels and read their history.')];
    },
  },
};

/**
 * The "Connected services" card: every account the reader added, one group per service, each with what it is used
 * for (link details, AI context) and an "Add account" form. Accounts and their keys stay in `storage.local`.
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', children: ReadonlyArray<Node | string> = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  node.append(...children);
  return node;
}

function rich(copy: string): Node[] {
  return splitInlineCode(copy).map((run) => (run.kind === 'code' ? el('code', '', [run.text]) : run.kind === 'strong' ? el('strong', '', [run.text]) : document.createTextNode(run.text)));
}

const fetchImpl = (input: string, init?: RequestInit): Promise<Response> => fetch(input, init);

const USE_COPY: Readonly<Record<keyof ConnectionUse, { readonly label: string; readonly help: string }>> = {
  details: { label: 'Link details', help: 'Titles and states in Related links' },
  ai: { label: 'AI context', help: 'Sent to your AI gateway when you run Triage with AI' },
};

export interface ConnectionsCardOptions {
  /** Whether the Connected services experiment is on, which is when links are read at all. */
  readonly enabled: () => boolean;
}

export function mountConnectionsCard(root: HTMLElement, options: ConnectionsCardOptions): { readonly refresh: () => void } {
  let connections: Connection[] = [];
  let open: string | null = null;
  const body = el('div', 'options__connections');
  const notice = el('p', 'geld-help options__connections-off');
  root.append(notice, body);

  const save = async (next: readonly Connection[]): Promise<void> => {
    connections = [...next];
    await writeConnections(connections);
    render();
  };

  function useBox(connection: Connection, use: keyof ConnectionUse): HTMLElement {
    const box = el('input', 'geld-checkbox options__checkbox');
    box.type = 'checkbox';
    box.checked = connection.use[use];
    box.setAttribute('aria-label', `${USE_COPY[use].label} for ${connection.label}`);
    box.addEventListener('change', async () => {
      const checked = box.checked;
      if (use === 'ai' && checked) {
        const spec = [...KEY_SERVICES, ...APP_SERVICES].find((candidate) => candidate.id === connection.service);
        const ok = window.confirm(
          `Use ${spec?.name ?? connection.service} (${connection.label}) for AI context?\n\nWhen you run Triage with AI, the titles, descriptions and messages of the items this account opens are sent to your own AI gateway with the pull request. Nothing is sent until you run it.`,
        );
        if (!ok) {
          box.checked = false;
          return;
        }
      }
      await save(connections.map((candidate) => (candidate.id === connection.id ? { ...candidate, use: { ...candidate.use, [use]: checked } } : candidate)));
    });
    return el('label', 'options__connection-use', [box, el('span', '', [USE_COPY[use].label])]);
  }

  function connectionRow(connection: Connection): HTMLElement {
    const name = el('span', 'options__connection-name', [connection.label]);
    const meta = el('span', 'options__connection-meta geld-muted', [[connection.account, connection.host].filter((part) => part !== null && part !== '').join(' · ')]);
    const status = el('span', 'geld-status options__connection-status');
    status.setAttribute('aria-live', 'polite');
    const remove = el('button', 'geld-button geld-button--small', ['Remove']);
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Remove ${connection.label}? Its key is deleted from this device.`)) return;
      await APP_FLOWS[connection.service]?.revoke(connection);
      await save(connections.filter((candidate) => candidate.id !== connection.id));
    });
    const row = el('li', 'options__connection', [el('span', 'options__connection-text', [name, meta]), useBox(connection, 'details'), useBox(connection, 'ai'), el('span', 'options__connection-actions', [status, remove])]);
    void hasOrigins(connection).then((granted) => {
      if (granted) return;
      const allow = el('button', 'geld-button geld-button--small', ['Allow access']);
      allow.type = 'button';
      allow.title = 'Your browser has not allowed Geld to reach this service';
      allow.addEventListener('click', async () => {
        if (await requestOrigins(connection)) allow.remove();
      });
      status.replaceWith(allow);
    });
    return row;
  }

  function field(label: string, input: HTMLInputElement, help: string | readonly Node[] | null): HTMLElement {
    const id = `connection-${Math.random().toString(36).slice(2)}`;
    input.id = id;
    const labelNode = el('label', 'geld-label', [label]);
    labelNode.htmlFor = id;
    return el('div', 'options__connection-field', [labelNode, input, ...(help === null ? [] : [el('p', 'geld-help', typeof help === 'string' ? rich(help) : help)])]);
  }

  function addForm(spec: ServiceSpec): HTMLElement {
    const input = (placeholder: string, type = 'text'): HTMLInputElement => {
      const node = el('input', 'geld-input options__input options__input--grow');
      node.type = type;
      node.placeholder = placeholder;
      node.spellcheck = false;
      node.autocomplete = 'off';
      return node;
    };
    const label = input('Work');
    const host = spec.host === null ? null : input(spec.host.placeholder);
    const email = spec.email === null ? null : input(spec.email.placeholder, 'email');
    const key = input(spec.key.placeholder, 'password');
    const status = el('span', 'geld-status');
    status.setAttribute('aria-live', 'polite');
    const submit = el('button', 'geld-button geld-button--primary', ['Test and save']);
    submit.type = 'submit';
    const cancel = el('button', 'geld-button', ['Cancel']);
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      open = null;
      render();
    });
    const create = spec.key.url === null ? null : el('a', '', ['Create one']);
    if (create !== null && spec.key.url !== null) {
      create.href = spec.key.url;
      create.target = '_blank';
      create.rel = 'noreferrer';
    }
    const keyHelp: Node[] = [...(spec.key.help === null ? [] : rich(spec.key.help)), ...(create === null ? [] : [document.createTextNode(' '), create])];
    const form = el('form', 'options__connection-form', [
      field('Label', label, 'Your own name for this account, such as Work or Personal.'),
      ...(host === null || spec.host === null ? [] : [field(spec.host.label, host, spec.host.help)]),
      ...(email === null || spec.email === null ? [] : [field(spec.email.label, email, spec.email.help)]),
      field(spec.key.label, key, keyHelp),
      el('div', 'geld-row options__actions', [status, cancel, submit]),
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const draft: ConnectionDraft = {
        service: spec.id,
        label: label.value,
        host: host?.value.trim() || null,
        secret: key.value.trim(),
        email: email?.value.trim() || null,
      };
      if (draft.secret === '') return showStatus(status, `Paste the ${spec.key.label.toLowerCase()}`, 'error');
      if (spec.host?.required === true && draft.host === null) return showStatus(status, `Add the ${spec.host.label.toLowerCase()}`, 'error');
      const resolver = resolverFor(spec.id);
      if (resolver === null) return showStatus(status, 'This service is not available yet', 'error');
      if (!(await requestOrigins(draft))) return showStatus(status, `Your browser did not allow Geld to reach ${spec.name}`, 'error');
      submit.disabled = true;
      showStatus(status, `Checking with ${spec.name}…`, 'neutral');
      const result = await resolver.identify(draft, fetchImpl);
      submit.disabled = false;
      if (!result.ok) return showStatus(status, result.message, 'error');
      const connection = connectionFrom(crypto.randomUUID(), draft, result.identity);
      const duplicate = connections.find((candidate) => candidate.service === connection.service && candidate.account === connection.account && candidate.host === connection.host);
      open = null;
      await save(duplicate === undefined ? [...connections, connection] : connections.map((candidate) => (candidate === duplicate ? { ...connection, id: duplicate.id, use: duplicate.use } : candidate)));
    });
    queueMicrotask(() => label.focus());
    return form;
  }

  function group(spec: ServiceSpec): HTMLElement {
    const mine = connections.filter((connection) => connection.service === spec.id);
    const add = el('button', 'geld-button geld-button--small', [mine.length === 0 ? `Add ${spec.name} account` : 'Add another account']);
    add.type = 'button';
    add.addEventListener('click', () => {
      open = spec.id;
      render();
    });
    const list = el('ul', 'options__connection-list', mine.map(connectionRow));
    return el('div', 'options__block options__connection-group', [
      el('div', 'geld-row options__connection-head', [el('div', '', [el('h3', 'options__group-title', [spec.name]), el('p', 'geld-help', rich(spec.blurb))]), ...(open === spec.id ? [] : [add])]),
      ...(mine.length === 0 ? [] : [list]),
      ...(open === spec.id ? [addForm(spec)] : []),
    ]);
  }

  /** A service connected by signing in through Geld's own app for it: one sign-in per workspace. */
  function appGroup(spec: AppServiceSpec): HTMLElement {
    const mine = connections.filter((connection) => connection.service === spec.id);
    const status = el('span', 'geld-status');
    status.setAttribute('aria-live', 'polite');
    const flow = APP_FLOWS[spec.id];
    const ready = flow?.ready === true;
    const connect = el('button', 'geld-button geld-button--small', [mine.length === 0 ? spec.connectLabel : spec.anotherLabel]);
    connect.type = 'button';
    connect.disabled = !ready;
    if (!ready) connect.title = spec.pending;
    connect.addEventListener('click', async () => {
      if (flow === undefined) return;
      let granted = false;
      try {
        granted = await browser.permissions.request({ origins: [...flow.origins] });
      } catch {
        granted = false;
      }
      if (!granted) return showStatus(status, `Your browser did not allow Geld to reach ${spec.name}`, 'error');
      connect.disabled = true;
      showStatus(status, `Finish signing in on ${spec.name}…`, 'neutral');
      const result = await flow.connect(connections);
      connect.disabled = false;
      if (!result.ok) return showStatus(status, result.message, 'error');
      const known = connections.some((candidate) => candidate.id === result.connection.id);
      await save(known ? connections.map((candidate) => (candidate.id === result.connection.id ? result.connection : candidate)) : [...connections, result.connection]);
    });
    return el('div', 'options__block options__connection-group', [
      el('div', 'geld-row options__connection-head', [el('div', '', [el('h3', 'options__group-title', [spec.name]), el('p', 'geld-help', rich(ready ? spec.blurb : `${spec.blurb} ${spec.pending}`)), ...(ready && flow?.note !== undefined ? [el('p', 'geld-help', [...flow.note()])] : []), status]), connect]),
      ...(mine.length === 0 ? [] : [el('ul', 'options__connection-list', mine.map(connectionRow))]),
    ]);
  }

  function render(): void {
    notice.textContent = options.enabled() ? '' : 'Links are read with these accounts only while the Connected services experiment is on.';
    notice.hidden = options.enabled();
    const column = (use: keyof ConnectionUse): HTMLElement => {
      const heading = el('span', 'options__connection-column geld-muted', [USE_COPY[use].label]);
      heading.title = USE_COPY[use].help;
      return heading;
    };
    body.replaceChildren(
      el('div', 'options__stack', [
        el('div', 'options__block options__connection-legend', [
          el('p', 'geld-help', [`${USE_COPY.details.label}: ${USE_COPY.details.help}. ${USE_COPY.ai.label}: ${USE_COPY.ai.help}, off until you turn it on.`]),
          column('details'),
          column('ai'),
        ]),
        ...APP_SERVICES.map(appGroup),
        ...KEY_SERVICES.map(group),
      ]),
    );
  }

  async function reload(): Promise<void> {
    connections = await readConnections();
    render();
  }

  watchConnections((next) => {
    connections = next;
    if (open === null) render();
  });
  void reload();
  return { refresh: render };
}

function showStatus(node: HTMLElement, message: string, tone: 'success' | 'error' | 'neutral'): void {
  node.textContent = message;
  if (tone === 'neutral') delete node.dataset.tone;
  else node.dataset.tone = tone;
}
