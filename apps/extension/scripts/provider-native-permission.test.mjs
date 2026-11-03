import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { confirmNativeProviderPermission } from './provider-native-permission.mjs';

const python = fileURLToPath(new URL('./provider-native-permission.py', import.meta.url));
const button = name => ({ name, enabled: true, showing: true, actions: ['click'] });
const dialog = () => ({ owned_pid: 123, native: true, role: 'dialog', showing: true, active: true,
  text: 'Geld requests additional permissions\nRead and change your data on gitlab.com', buttons: [button('Allow'), button('Cancel')] });
const qualify = cases => JSON.parse(execFileSync('/usr/bin/python3', ['-B', '-c', `
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('dialog',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
print(json.dumps([module.qualifies(item, 'gitlab', 123) for item in json.load(sys.stdin)]))
`, python], { input: JSON.stringify(cases), encoding: 'utf8' }));

test('native confirmation requires the owned Chrome dialog, exact host and visible Allow action', () => {
  const bad = [
    value => { value.owned_pid = 999; }, value => { value.native = false; }, value => { value.role = 'document web'; },
    value => { value.active = false; }, value => { value.truncated = true; }, value => { value.showing = false; },
    value => { value.text = value.text.replace('Geld', 'Different extension'); },
    value => { value.text += '\nexample.com'; }, value => { value.text += '\nall websites'; },
    value => { value.buttons[0].enabled = false; }, value => { value.buttons[0].showing = false; },
    value => { value.buttons[0].actions = []; }, value => { value.buttons.push(button('Allow')); },
    value => { value.buttons = [button('Allow')]; },
  ].map(mutate => { const value = dialog();mutate(value);return value; });
  assert.deepEqual(qualify([dialog(), ...bad]), [true, ...bad.map(() => false)]);
});
test('already-granted origins await worker registration without touching any native UI', async () => {
  let executions = 0;
  const result = await confirmNativeProviderPermission('gitlab', 123, async () => ({ permissions: { origins: ['https://gitlab.com/*'] } }), async () => { executions++; });
  assert.equal(result.phase, 'worker_registration');assert.equal(executions, 0);
});
test('ungranted permission uses only the bounded native-dialog helper and refuses an unqualified prompt', async () => {
  const read = async () => ({ permissions: { origins: [] } });
  const confirmed = await confirmNativeProviderPermission('gitlab', 123, read, async (command, args, options) => {
    assert.equal(command, '/usr/bin/python3');assert.deepEqual(args.slice(2), ['--provider', 'gitlab', '--browser-pid', '123', '--seconds', '10']);
    assert.equal(options.timeout, 12_000);return { stdout: JSON.stringify({ status: 'confirmed', method: 'owned_native_atspi_allow' }) };
  });
  assert.equal(confirmed.status, 'confirmed');
  await assert.rejects(confirmNativeProviderPermission('gitlab', 123, read, async () => ({ stdout: '{"status":"unavailable","reason":"qualified_native_dialog_not_found"}' })), /No qualified native/);
});

test('native traversal rejects web dialogs, foreign processes and truncated host or dialog scans', () => {
  const result = JSON.parse(execFileSync('/usr/bin/python3', ['-B', '-c', `
import importlib.util,json,sys,types
spec=importlib.util.spec_from_file_location('dialog',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
clicked=[]
class States:
 def __init__(self, values): self.values=values
 def contains(self, value): return value in self.values
class Action:
 nActions=1
 def __init__(self,name): self.name=name
 def getName(self,index): return 'click'
 def doAction(self,index): clicked.append(self.name);return True
class Node:
 def __init__(self,role,name='',children=(),pid=123): self.role=role;self.name=name;self.children=children;self.pid=pid
 def __iter__(self): return iter(self.children)
 def getRoleName(self): return self.role
 def getState(self): return States({'ACTIVE','SHOWING','ENABLED'})
 def get_process_id(self): return self.pid
 def queryAction(self): return Action(self.name)
def dialog(): return Node('dialog','Geld requests additional permissions',[Node('label','Read and change your data on gitlab.com'),Node('push button','Allow'),Node('push button','Cancel')])
desktop=[Node('application',children=[Node('frame',children=[dialog(),Node('document web',children=[dialog()])])]),Node('application',children=[dialog()],pid=999)]
api=types.SimpleNamespace(STATE_ACTIVE='ACTIVE',STATE_SHOWING='SHOWING',STATE_ENABLED='ENABLED',Registry=types.SimpleNamespace(getDesktop=lambda index:desktop))
module.owned_process=lambda pid,owner:pid==owner
sys.modules['pyatspi']=api
records=module.native_dialogs(api,123)
receipt=module.confirm('gitlab',123,1)
count=len(records['dialogs'])
extra=Node('dialog','Geld requests additional permissions',[Node('label','Read and change your data on gitlab.com'),Node('push button','Allow'),Node('push button','Cancel')]+[Node('group') for _ in range(61)]+[Node('label','unexpected.example')])
desktop=[Node('application',children=[extra])]
truncated=module.confirm('gitlab',123,1)
desktop=[Node('application',children=[dialog()]+[Node('group') for _ in range(63)]+[dialog()])]
outer=module.confirm('gitlab',123,1)
desktop=[Node('application',children=[Node('dialog','Geld requests additional permissions',[Node('label','Read and change your data on gitlab.com'+' '*1100+'unexpected.example'),Node('push button','Allow'),Node('push button','Cancel')])])]
long_name=module.confirm('gitlab',123,1)
print(json.dumps({'nativeCount':count,'status':receipt['status'],'clicked':clicked,'truncatedReason':truncated.get('reason'),'outerReason':outer.get('reason'),'longNameReason':long_name.get('reason')}))
`, python], { encoding: 'utf8' }));
  assert.deepEqual(result, { nativeCount: 1, status: 'confirmed', clicked: ['Allow'], truncatedReason: 'native_tree_truncated', outerReason: 'native_tree_truncated', longNameReason: 'native_tree_truncated' });
});
