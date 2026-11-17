/**
 * Which kind of fix a finding needs, decided before any fix is drafted: a rewrite of only the lines its thread is on,
 * which can be posted as a suggestion, or a wider change (other code, other files, tests) for a coding agent. A
 * decision model answers it as one yes/no question per finding; without one, the reasoning model answers the same
 * question in a structured reply. Both end in a `FixRoute`, so the triage branches on one thing.
 *
 * It is the first of two gates: a finding it lets through is still drafted by a model told to propose nothing that
 * does not fit the thread's lines, so a wrong "lines" costs a drafting request, not a half fix.
 */

import { z } from 'zod';
import type { JevAnswer, JevQuestion, JevRequest } from './jev';
import type { SuggestInputItem, SuggestPullRequest } from './triage';

export interface FixRoute {
  /** How likely a proper fix needs more than the thread's lines, from 0 to 1. A reasoning model's answer is 0 or 1. */
  readonly wider: number;
  /** What has to change and where, when the reasoning model said wider. A decision model writes no text, so it is empty there. */
  readonly needs: string;
}

/** At or above this a finding goes to an agent: a drafted fix too narrow for the change is the costly mistake, so as likely as not is enough. */
export const WIDER_AT = 0.5;

export function needsAgent(route: FixRoute | undefined): boolean {
  return route !== undefined && route.wider >= WIDER_AT;
}

export type RouteInput = Pick<SuggestInputItem, 'id' | 'title' | 'path' | 'excerpts' | 'target' | 'around'>;

/** Findings per request: a decision model reads about 32k tokens, and each finding brings its lines and what was said. */
export const ROUTE_BATCH = 8;
const SAID_CHARS = 1_200;
const DESCRIPTION_CHARS = 1_500;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function routeState(pull: SuggestPullRequest, inputs: readonly RouteInput[]): Readonly<Record<string, unknown>> {
  return {
    pullRequest: { title: pull.title, description: clip(pull.description, DESCRIPTION_CHARS) },
    findings: inputs.map((input) => ({
      id: input.id,
      title: input.title,
      path: input.path,
      said: clip(input.excerpts.join(' / '), SAID_CHARS),
      target: input.target,
      around: input.around,
    })),
  };
}

export function routeKey(id: string): string {
  return `wider:${id}`;
}

const WIDER_CRITERIA: Readonly<Record<'true' | 'false', string>> = {
  true: 'A proper fix also changes code outside the target lines: other functions or callers in the file, other files, types, configuration or tests. Or the finding is a design question no edit to those lines answers.',
  false: 'Rewriting only the target lines fully fixes what the finding reports, with nothing else to change.',
};

/** One request per batch: the findings as state, one yes/no question each. Empty when there is nothing to ask. */
export function routeRequests(model: string, pull: SuggestPullRequest, inputs: readonly RouteInput[]): readonly JevRequest[] {
  const requests: JevRequest[] = [];
  for (let start = 0; start < inputs.length; start += ROUTE_BATCH) {
    const batch = inputs.slice(start, start + ROUTE_BATCH);
    const questions: Record<string, JevQuestion> = {};
    for (const input of batch) {
      questions[routeKey(input.id)] = {
        type: 'noul',
        instructions: `In \`findings\`, for the finding with id "${input.id}": does fixing it properly need changes outside its \`target\` lines, rather than only rewriting those lines?`,
        criteria: WIDER_CRITERIA,
      };
    }
    requests.push({ model, state: routeState(pull, batch), questions });
  }
  return requests;
}

/** The routes a decision model's answers give, by finding id. A question it left unanswered gives none, so that finding is drafted. */
export function routesFromAnswers(answers: Readonly<Record<string, JevAnswer>>): ReadonlyMap<string, FixRoute> {
  const routes = new Map<string, FixRoute>();
  for (const [key, answer] of Object.entries(answers)) {
    if (!key.startsWith('wider:') || answer.type !== 'noul') continue;
    routes.set(key.slice('wider:'.length), { wider: answer.noul, needs: '' });
  }
  return routes;
}

export const ROUTE_SYSTEM = `You decide, for each open review finding on a pull request, which kind of fix it needs, before anyone writes one.
Each finding has "target": the lines its review thread is on ("start" to "end", inclusive) and "text", those lines exactly. "around" is the code near them, each line led by its number, the target lines marked with ">".
Rules:
- "lines": rewriting only the target lines fully fixes what the finding reports, with nothing else to change.
- "wider": a proper fix also changes code outside the target lines: other functions or callers in the file, other files, types, configuration or tests. Also "wider" when the finding is a design question no edit to those lines answers.
- When unsure, choose "wider".
- "needs": for "wider", one sentence saying what has to change and where. Wrap code, symbols and file names in backticks. "" for "lines".
- Every finding id appears in exactly one entry. Never invent findings. Return JSON only, matching the schema.`;

export function routeUserPrompt(pull: SuggestPullRequest, inputs: readonly RouteInput[]): string {
  return JSON.stringify(routeState(pull, inputs), null, 2);
}

export const ROUTE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['routes'],
  properties: {
    routes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'scope', 'needs'],
        properties: {
          id: { type: 'string' },
          scope: { type: 'string', enum: ['lines', 'wider'] },
          needs: { type: 'string' },
        },
      },
    },
  },
} as const;

const routeOutputSchema = z.object({
  routes: z.array(
    z.object({
      id: z.string().min(1),
      scope: z.enum(['lines', 'wider']),
      needs: z.string().max(600).nullish(),
    }),
  ),
});

/** The reasoning model's routes for the ids asked about, the first entry per id. A finding it skipped gets none, so it is drafted. */
export function parseRouteOutput(text: string, ids: readonly string[]): ReadonlyMap<string, FixRoute> | null {
  let json: unknown;
  try {
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, ''));
  } catch {
    return null;
  }
  const parsed = routeOutputSchema.safeParse(json);
  if (!parsed.success) return null;
  const asked = new Set(ids);
  const routes = new Map<string, FixRoute>();
  for (const entry of parsed.data.routes) {
    if (!asked.has(entry.id) || routes.has(entry.id)) continue;
    routes.set(entry.id, entry.scope === 'wider' ? { wider: 1, needs: (entry.needs ?? '').trim() } : { wider: 0, needs: '' });
  }
  return routes;
}
