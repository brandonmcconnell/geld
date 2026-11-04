import {describe,expect,it} from 'vitest';
import {recognizeTickets,parseIssueTracker} from './trackers';
const repository={provider:'github',host:'github.com',owner:'acme',repo:'platform'} satisfies {provider:'github';host:string;owner:string;repo:string};
describe('read-only ticket recognition',()=>{
 it('ignores code, restricts keys and keeps bare references on the PR provider',()=>{const config={provider:'linear',keys:['ENG'],workspace:'acme'} satisfies NonNullable<ReturnType<typeof parseIssueTracker>>;const found=recognizeTickets('Fix ENG-12 and OTHER-8, #7. branch eng-12-fix\n`ENG-2 #3`\n```ts\nENG-4 #5\n```',repository,config);expect(found.map(r=>[r.provider,r.id])).toEqual([['github_issues','7'],['linear','ENG-12']]);});
 it('recognizes GitLab subgroups and excludes other repository scopes',()=>{const found=recognizeTickets('https://gitlab.com/acme/group/repo/-/issues/9 #3 https://gitlab.com/foreign/repo/-/issues/2',{provider:'gitlab',host:'gitlab.com',owner:'acme/group',repo:'repo'});expect(found.map(r=>r.id)).toEqual(['9','3']);});
 it('recognizes configured Jira, YouTrack, Asana and Monday URL formats',()=>{expect(recognizeTickets('APP-12 https://acme.atlassian.net/browse/APP-12',repository,{provider:'jira',keys:['APP'],baseUrl:'https://acme.atlassian.net'})).toHaveLength(1);expect(recognizeTickets('Api_32-143',repository,{provider:'youtrack',keys:['Api_32'],baseUrl:'https://example.youtrack.cloud'})[0]?.id).toBe('Api_32-143');expect(recognizeTickets('https://app.asana.com/0/123/456',repository,{provider:'asana',keys:['123']})[0]?.id).toBe('456');expect(recognizeTickets('https://acme.monday.com/boards/123/pulses/456',repository,{provider:'monday',keys:['123'],baseUrl:'https://acme.monday.com'})[0]?.id).toBe('456');});
 it('does not mistake project or PR links for issues and rejects credentialed URLs',()=>{expect(recognizeTickets('https://github.com/acme/platform/pull/12 https://github.com/user/repo/issues/7 https://evil@github.com/acme/platform/issues/9',repository)).toEqual([]);expect(parseIssueTracker({provider:'jira',keys:['KEY'],baseUrl:'http://localhost'})).toBeNull();});
});

describe('tracker scope identity',()=>{
 it('keeps projects with the same number under different owners and owner types',()=>{
  const found=recognizeTickets('https://github.com/orgs/acme/projects/5 https://github.com/users/alice/projects/5 https://github.com/users/acme/projects/5',repository,{provider:'github_projects',keys:['acme/5','alice/5']});
  expect(found.map(link=>link.repository)).toEqual(['orgs/acme/5','users/alice/5','users/acme/5']);
  expect(found).toHaveLength(3);
 });
 it('accepts an Asana task through its allowed project or workspace and rejects other scopes',()=>{
  const url='https://app.asana.com/1/123/project/456/task/789';
  expect(recognizeTickets(url,repository,{provider:'asana',keys:['456']})[0]?.id).toBe('789');
  expect(recognizeTickets(url,repository,{provider:'asana',keys:['123']})[0]?.id).toBe('789');
  expect(recognizeTickets(url,repository,{provider:'asana',keys:['999']})).toEqual([]);
 });
 it('keeps same-number issues from public and Enterprise hosts distinct',()=>{
  const found=recognizeTickets('https://github.com/acme/platform/issues/7 https://git.example.test/acme/platform/issues/7',{...repository,host:'git.example.test'});
  expect(found).toHaveLength(2);
 });
});
