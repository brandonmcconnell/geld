import { fetchGitLabStandaloneDiff } from './standalone-source';
import type { ProviderCommitPage, ProviderComparePage } from '../providers/types';

const HEAD = '13215ca460cd4f75d3765a882ef486aa2dacf549';
const BASE = '34ef0d2e2808bf3a7347b1b4352ac8babdfb645c';
const repository: ProviderCommitPage['repository'] = { provider: 'gitlab', origin: 'https://gitlab.com', path: 'gitlab-org/gitlab' };
const commit: ProviderCommitPage = { provider: 'gitlab', repository, kind: 'commit', ref: HEAD, headSha: HEAD, url: `https://gitlab.com/gitlab-org/gitlab/-/commit/${HEAD}`, diffPageUrl: `https://gitlab.com/gitlab-org/gitlab/-/commit/${HEAD}`, diffUrl: `https://gitlab.com/gitlab-org/gitlab/-/commit/${HEAD}.diff`, version: HEAD };
const compare: ProviderComparePage = { provider: 'gitlab', repository, kind: 'compare', from: BASE, to: HEAD, straight: false, headSha: HEAD, url: `https://gitlab.com/gitlab-org/gitlab/-/compare/${BASE}...${HEAD}`, diffPageUrl: `https://gitlab.com/gitlab-org/gitlab/-/compare/${BASE}...${HEAD}`, diffUrl: `https://gitlab.com/gitlab-org/gitlab/-/compare/${BASE}...${HEAD}?format=diff`, version: `${BASE}...${HEAD}` };
const metadata = {"diff_files":[{"conflict_type":null,"added_lines":2,"removed_lines":0,"new_path":"app/graphql/mutations/boards/issues/issue_move_list.rb","old_path":"app/graphql/mutations/boards/issues/issue_move_list.rb","new_file":false,"deleted_file":false,"submodule":false,"file_identifier_hash":"11e6be9a391c381f790edae2f51fb384f95f8cde","file_hash":"2384b693797296a4feb5371e4c1a775b92dbbeb4","code_review_id":"def4a8da55f89fa828845608355ebeb140a59a44"},{"conflict_type":null,"added_lines":2,"removed_lines":0,"new_path":"app/services/boards/base_item_move_service.rb","old_path":"app/services/boards/base_item_move_service.rb","new_file":false,"deleted_file":false,"submodule":false,"file_identifier_hash":"0bac346073d80c60b00d81ee8ca8a65ddc2cfd65","file_hash":"0b7f55307397ee478e05e1bf391f6d7e4b6aa606","code_review_id":"b64815fe068cd41ebff650abd7b80ffbafca6dbc"},{"conflict_type":null,"added_lines":32,"removed_lines":0,"new_path":"spec/graphql/mutations/boards/issues/issue_move_list_spec.rb","old_path":"spec/graphql/mutations/boards/issues/issue_move_list_spec.rb","new_file":false,"deleted_file":false,"submodule":false,"file_identifier_hash":"d063af479e73bd2ff291f12cf2d83254c30f40e1","file_hash":"1368db605e5982dfe6a6596a37b7cb054d48d61d","code_review_id":"019271d5e9aaae129d85f3585c16c1acf7a767cd"}]};
const statistics = {"diffs_stats":{"added_lines":36,"removed_lines":0,"diffs_count":3,"real_size":"3"}};
const patch = "diff --git a/app/graphql/mutations/boards/issues/issue_move_list.rb b/app/graphql/mutations/boards/issues/issue_move_list.rb\nindex 3838f26f0ebd9a92099e5b741b52940724d78d35..3420b732733466f2aca62bf2f879faf5dd9d700d 100644\n--- a/app/graphql/mutations/boards/issues/issue_move_list.rb\n+++ b/app/graphql/mutations/boards/issues/issue_move_list.rb\n@@ -107,6 +107,8 @@ def move_arguments(args)\n         end\n \n         def error_for(result)\n+          # The move service returns nil, not an error, when the lists are not on the board or the user cannot move it.\n+          return ['Item could not be moved. Check the list IDs and your permissions on this board.'] if result.nil?\n           return [] unless result.error?\n \n           [result.message]\ndiff --git a/app/services/boards/base_item_move_service.rb b/app/services/boards/base_item_move_service.rb\nindex 379d04c41e52755a2c0a489dcf7f30e30be60f2c..3b6ae3789d88193f121d1e1bb69f322d32ce829e 100644\n--- a/app/services/boards/base_item_move_service.rb\n+++ b/app/services/boards/base_item_move_service.rb\n@@ -100,6 +100,8 @@ def board_label_ids\n     end\n \n     def move_params_from_list_position(position)\n+      return {} unless moving_to_list\n+\n       if position == LIST_END_POSITION\n         { move_before_id: moving_to_list_items_relation.reverse_order.pick(:id), move_after_id: nil }\n       else\ndiff --git a/spec/graphql/mutations/boards/issues/issue_move_list_spec.rb b/spec/graphql/mutations/boards/issues/issue_move_list_spec.rb\nindex 3734923503fc27370bfb6218ca99f8e121cce75b..6c94d283090212a4fee016ae9310312099808756 100644\n--- a/spec/graphql/mutations/boards/issues/issue_move_list_spec.rb\n+++ b/spec/graphql/mutations/boards/issues/issue_move_list_spec.rb\n@@ -100,6 +100,16 @@\n         end\n       end\n \n+      context 'when the list IDs are not lists on the board' do\n+        let(:move_params) do\n+          { from_list_id: global_id_of(list1).to_s, to_list_id: global_id_of(list2).to_s, position_in_list: 0 }\n+        end\n+\n+        it 'returns an error' do\n+          expect(subject[:errors]).to contain_exactly('Item could not be moved. Check the list IDs and your permissions on this board.')\n+        end\n+      end\n+\n       context 'when position_in_list is invalid' do\n         let(:move_params) { { from_list_id: list1.id, to_list_id: list2.id, position_in_list: -5 } }\n \n@@ -121,6 +131,28 @@\n       end\n     end\n \n+    context 'when the list IDs are not lists on the board' do\n+      let(:move_params) { { from_list_id: global_id_of(list1).to_s, to_list_id: global_id_of(list2).to_s } }\n+\n+      it 'returns an error and does not move the issue' do\n+        expect(subject[:errors]).to contain_exactly('Item could not be moved. Check the list IDs and your permissions on this board.')\n+        expect(issue1.reload.labels).to eq([development])\n+      end\n+    end\n+\n+    context 'when the user can update the issue but cannot move it' do\n+      let_it_be(:guest_issue) { create(:labeled_issue, project: project, labels: [development], author: guest) }\n+\n+      let(:current_ctx) { { current_user: guest } }\n+      let(:params) { { board_id: global_id_of(board), project_path: project.full_path, iid: guest_issue.iid.to_s } }\n+      let(:move_params) { { from_list_id: list1.id, to_list_id: list2.id } }\n+\n+      it 'returns an error and does not move the issue' do\n+        expect(subject[:errors]).to contain_exactly('Item could not be moved. Check the list IDs and your permissions on this board.')\n+        expect(guest_issue.reload.labels).to eq([development])\n+      end\n+    end\n+\n     context 'when user cannot update issue' do\n       let(:current_ctx) { { current_user: guest } }\n \n";

function responses(files: unknown = metadata, stats: unknown = statistics, diff = patch): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/diff_files_metadata')) return new Response(JSON.stringify(files), { headers: { 'content-type': 'application/json' } });
    if (url.pathname.endsWith('/diffs_stats')) return new Response(JSON.stringify(stats), { headers: { 'content-type': 'application/json' } });
    if (url.pathname.endsWith('.diff') || url.searchParams.get('format') === 'diff') return new Response(diff, { headers: { 'content-type': 'text/plain' } });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

afterEach(() => vi.unstubAllGlobals());

it('counts the real public standalone commit through pinned metadata and raw diff', async () => {
  const fetcher = responses();
  const signal = new AbortController().signal;
  const result = await fetchGitLabStandaloneDiff(commit, signal);
  expect(result.complete).toBe(true);
  expect(result.files).toHaveLength(3);
  expect(result.files.reduce((sum, file) => sum + file.additions, 0)).toBe(36);
  expect(result.revision).toContain(HEAD);
  expect(fetcher.mock.calls.every((call) => call[1]?.signal === signal)).toBe(true);
  expect(fetcher.mock.calls.map((call) => String(call[0])).every((url) => !url.includes('merge_requests'))).toBe(true);
});

it('preserves native merge-base versus direct comparison semantics and both immutable ends', async () => {
  const merge = responses();
  expect((await fetchGitLabStandaloneDiff(compare, new AbortController().signal)).complete).toBe(true);
  const mergeRaw = merge.mock.calls.map((call) => new URL(String(call[0]))).find((url) => url.searchParams.get('format') === 'diff');
  expect(mergeRaw?.pathname).toContain(`${BASE}...${HEAD}`);
  expect(mergeRaw?.searchParams.has('straight')).toBe(false);
  const direct = responses();
  await fetchGitLabStandaloneDiff({ ...compare, straight: true }, new AbortController().signal);
  expect(direct.mock.calls.every((call) => new URL(String(call[0])).searchParams.get('straight') === 'true')).toBe(true);
});

it('refuses truncated file inventories, overflow counts and partial raw patches', async () => {
  responses({ diff_files: metadata.diff_files.slice(0, 1) });
  expect((await fetchGitLabStandaloneDiff(compare, new AbortController().signal)).complete).toBe(false);
  responses(metadata, { diffs_stats: { ...statistics.diffs_stats, real_size: '1000+' } });
  expect((await fetchGitLabStandaloneDiff(compare, new AbortController().signal)).complete).toBe(false);
  responses(metadata, statistics, '');
  expect((await fetchGitLabStandaloneDiff(compare, new AbortController().signal)).complete).toBe(false);
});

it('accepts a genuinely empty complete comparison', async () => {
  responses({ diff_files: [] }, { diffs_stats: { real_size: '0', diffs_count: 0, added_lines: 0, removed_lines: 0 } }, '');
  expect(await fetchGitLabStandaloneDiff(compare, new AbortController().signal)).toMatchObject({ complete: true, files: [] });
});

it('resolves a short commit before using immutable source URLs and rejects a different resolved head', async () => {
  const baseFetch = responses();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => String(input).includes('/repository/commits/13215ca4') ? new Response(JSON.stringify({ id: HEAD })) : baseFetch(input, init));
  vi.stubGlobal('fetch', fetcher);
  expect((await fetchGitLabStandaloneDiff({ ...commit, ref: '13215ca4' }, new AbortController().signal)).complete).toBe(true);
  expect(fetcher.mock.calls.map((call) => String(call[0])).some((url) => url.endsWith(`/commit/${HEAD}/diff_files_metadata`))).toBe(true);
  await expect(fetchGitLabStandaloneDiff({ ...commit, headSha: BASE }, new AbortController().signal)).rejects.toThrow('revision changed');
});

it('does not return a branch comparison whose refs moved during loading', async () => {
  const baseFetch = responses();
  let baseReads = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    if (String(input).includes('/repository/commits/main')) return new Response(JSON.stringify({ id: ++baseReads === 1 ? BASE : 'f'.repeat(40) }));
    return baseFetch(input, init);
  });
  vi.stubGlobal('fetch', fetcher);
  await expect(fetchGitLabStandaloneDiff({ ...compare, from: 'main' }, new AbortController().signal)).rejects.toThrow('refs changed');
});
