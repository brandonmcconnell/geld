import type { ProviderReviewPage } from '../providers/types';
import { fetchGitLabDiff } from './source';

const HEAD = 'd7614ded66e446a388a52625ca13bcb19d43465c';
const BASE = 'b7c44b3b2a113a284afdc1d8c7ecedd3cc3bb2cf';
const metadata = {"real_size":"1","size":1,"branch_name":"45648-fix-flaky-work-items-n-plus-one-specs","source_branch_exists":false,"target_branch_name":"master","commit":null,"context_commits":null,"merge_request_diff":{"version_index":null,"created_at":"2026-11-01T11:30:05.029Z","commits_count":1,"latest":true,"short_commit_sha":"d7614ded","base_version_path":"/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=2158495265","head_version_path":null,"version_path":"/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=2158495265","compare_path":"/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=2158495265\u0026start_sha=d7614ded66e446a388a52625ca13bcb19d43465c"},"start_version":null,"latest_diff":true,"latest_version_path":"/gitlab-org/gitlab/-/merge_requests/266882/diffs","added_lines":4,"removed_lines":1,"render_overflow_warning":false,"email_patch_path":"/gitlab-org/gitlab/-/merge_requests/266882.patch","plain_diff_path":"/gitlab-org/gitlab/-/merge_requests/266882.diff","merge_request_diffs":[{"version_index":null,"created_at":"2026-11-01T11:30:05.029Z","commits_count":1,"latest":true,"short_commit_sha":"d7614ded","base_version_path":"/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=2158495265","head_version_path":null,"version_path":"/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=2158495265","compare_path":"/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=2158495265\u0026start_sha=d7614ded66e446a388a52625ca13bcb19d43465c"}],"definition_path_prefix":"/gitlab-org/gitlab/-/blob/d7614ded66e446a388a52625ca13bcb19d43465c","context_commits_diff":null,"diff_files":[{"conflict_type":null,"added_lines":4,"removed_lines":1,"new_path":"spec/requests/api/graphql/project/work_items_spec.rb","old_path":"spec/requests/api/graphql/project/work_items_spec.rb","new_file":false,"deleted_file":false,"submodule":false,"file_identifier_hash":"3d580d161b043b96e323f3067b855ce0752fa644","file_hash":"bab0cb834cc34b971c81f791b0e3bdcbd5d2b285","code_review_id":"95ee50be27ca07ab3023c41a0548d6ea53234af8"}],"conflict_resolution_path":null,"has_conflicts":false,"can_merge":false,"project_path":"gitlab-org/gitlab","project_name":"GitLab","username":null,"user_full_name":null,"has_encoded_file_paths":false};
const versions = {"source_versions":[{"id":2158495265,"version_index":null,"is_merge_head":false,"latest":true,"short_commit_sha":"d7614ded","commits_count":1,"created_at":"2026-11-01T11:30:05.029Z","head_sha":"d7614ded66e446a388a52625ca13bcb19d43465c","base_sha":"b7c44b3b2a113a284afdc1d8c7ecedd3cc3bb2cf","start_sha":"b7c44b3b2a113a284afdc1d8c7ecedd3cc3bb2cf","selected":true,"href":"/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=2158495265"}],"target_versions":[{"id":2158495265,"version_index":null,"is_merge_head":false,"latest":true,"short_commit_sha":"d7614ded","commits_count":1,"created_at":"2026-11-01T11:30:05.029Z","start_sha":"b7c44b3b2a113a284afdc1d8c7ecedd3cc3bb2cf","head_sha":"d7614ded66e446a388a52625ca13bcb19d43465c","selected":true,"href":"/gitlab-org/gitlab/-/merge_requests/266882/diffs","branch":"master","is_head":false,"is_base":true}],"context_commits":null};
const raw = "diff --git a/spec/requests/api/graphql/project/work_items_spec.rb b/spec/requests/api/graphql/project/work_items_spec.rb\nindex b463fd50f458fcc471a501e82b4937233e239f7a..bef030c8809059041a5371134ff1a3a42b491abd 100644\n--- a/spec/requests/api/graphql/project/work_items_spec.rb\n+++ b/spec/requests/api/graphql/project/work_items_spec.rb\n@@ -2,7 +2,10 @@\n \n require 'spec_helper'\n \n-RSpec.describe 'getting a work item list for a project', feature_category: :portfolio_management do\n+# Clearing shared state drops the Users::ActivityService lease left by earlier examples, so the\n+# warmup request records activity and the N+1 control and comparison requests both skip it.\n+RSpec.describe 'getting a work item list for a project', :clean_gitlab_redis_shared_state,\n+  feature_category: :portfolio_management do\n   include_context 'with work items list request'\n \n   let_it_be(:label1) { create(:label, project: project) }\n";
const page: ProviderReviewPage = {
  provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'gitlab-org/gitlab' },
  number: '266882', url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882',
  diffPageUrl: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=2158495265',
  diffUrl: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266882.diff?diff_id=2158495265',
  kind: 'diff', headSha: HEAD, version: '2158495265',
};

function replies(meta: unknown = metadata, diff = raw, selectedVersions: unknown = versions): ReturnType<typeof vi.fn> {
  const fn = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify(selectedVersions), { headers: { 'content-type': 'application/json' } }))
    .mockResolvedValueOnce(new Response(diff, { headers: { 'content-type': 'text/plain' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

it('counts the full public MR and uses immutable compare refs because MR .diff ignores version selection', async () => {
  const request = replies();
  const signal = new AbortController().signal;
  const result = await fetchGitLabDiff(page, signal);
  expect(result.complete).toBe(true);
  expect(result.files).toMatchObject([{ path: 'spec/requests/api/graphql/project/work_items_spec.rb', additions: 4, deletions: 1 }]);
  expect(result.patches?.size).toBe(1);
  expect(String(request.mock.calls[2]?.[0])).toBe(`https://gitlab.com/gitlab-org/gitlab/-/compare/${BASE}...${HEAD}?format=diff&straight=true`);
  expect(request.mock.calls.every((call) => call[1]?.signal === signal)).toBe(true);
});

it('never treats a truncated patch, overflow or missing metadata as a complete zero-file change', async () => {
  replies(metadata, '');
  expect((await fetchGitLabDiff(page, new AbortController().signal)).complete).toBe(false);
  replies({ ...metadata, render_overflow_warning: true });
  expect((await fetchGitLabDiff(page, new AbortController().signal)).complete).toBe(false);
  replies({ ...metadata, real_size: '1000+' });
  expect((await fetchGitLabDiff(page, new AbortController().signal)).complete).toBe(false);
  replies({ error: 'unavailable' });
  await expect(fetchGitLabDiff(page, new AbortController().signal)).rejects.toThrow('metadata is incomplete');
});

it('rejects a different selected version or an advanced head', async () => {
  replies({ ...metadata, merge_request_diff: { version_path: '/gitlab-org/gitlab/-/merge_requests/266882/diffs?diff_id=9' } });
  await expect(fetchGitLabDiff(page, new AbortController().signal)).rejects.toThrow('different diff version');
  replies();
  await expect(fetchGitLabDiff({ ...page, headSha: 'a'.repeat(40) }, new AbortController().signal)).rejects.toThrow('another revision');
});

it('rejects login HTML delivered as 200 and explicit unauthorized responses', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } })));
  await expect(fetchGitLabDiff(page, new AbortController().signal)).rejects.toThrow('page instead of changes');
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 })));
  await expect(fetchGitLabDiff(page, new AbortController().signal)).rejects.toThrow('Sign in');
});

it('pins a selected version comparison rather than counting the whole MR', async () => {
  const otherBase = 'c'.repeat(40);
  const request = replies(metadata, raw, { ...versions, target_versions: [{ selected: true, start_sha: otherBase }] });
  await fetchGitLabDiff({ ...page, diffPageUrl: `${page.diffPageUrl}&start_sha=${otherBase}&w=1&unexpected=https://example.com` }, new AbortController().signal);
  expect(String(request.mock.calls[0]?.[0])).toContain(`diff_id=2158495265&start_sha=${otherBase}&w=1`);
  expect(String(request.mock.calls[2]?.[0])).toBe(`https://gitlab.com/gitlab-org/gitlab/-/compare/${otherBase}...${HEAD}?format=diff&straight=true&w=1`);
  expect(String(request.mock.calls[0]?.[0])).not.toContain('unexpected');
});

it('rejects an unrecognized comparison base instead of counting a different UI selection', async () => {
  replies();
  await expect(fetchGitLabDiff({ ...page, diffPageUrl: `${page.diffPageUrl}&start_sha=${'c'.repeat(40)}` }, new AbortController().signal)).rejects.toThrow('different comparison base');
});

it('pins a selected single commit and verifies metadata identified that commit', async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...metadata, merge_request_diff: null, commit: { id: HEAD, parent_ids: [BASE] } })))
    .mockResolvedValueOnce(new Response(raw));
  vi.stubGlobal('fetch', request);
  const result = await fetchGitLabDiff({ ...page, diffPageUrl: `${page.url}/diffs?commit_id=${HEAD}` }, new AbortController().signal);
  expect(result.complete).toBe(true);
  expect(String(request.mock.calls[1]?.[0])).toBe(`https://gitlab.com/gitlab-org/gitlab/-/commit/${HEAD}.diff`);
});

it('passes GitLab Retry-After through to the shared provider queue', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '35' } })));
  await expect(fetchGitLabDiff(page, new AbortController().signal)).rejects.toMatchObject({ retryAfter: '35' });
});
