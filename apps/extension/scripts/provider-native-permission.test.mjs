import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { confirmNativeProviderPermission, prepareNativeAccessibilityBus, nativeAccessibilityEnvironment, probeNativeChromeAccessibility } from './provider-native-permission.mjs';

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

test('scanner diagnostics distinguish registry, process ownership and native role gaps without labels', () => {
  const result = JSON.parse(execFileSync('/usr/bin/python3', ['-B', '-c', `
import importlib.util,json,sys,types
spec=importlib.util.spec_from_file_location('dialog',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class States:
 def contains(self,value): return True
class Node:
 def __init__(self,role,name='PRIVATE_CANARY',children=(),pid=123): self.role=role;self.name=name;self.children=children;self.pid=pid
 def __iter__(self): return iter(self.children)
 def getRoleName(self): return self.role
 def getState(self): return States()
 def get_process_id(self): return self.pid
class BadPid(Node):
 def get_process_id(self): raise RuntimeError('PRIVATE_ERROR')
module.owned_process=lambda pid,owner:pid==owner
scenarios=[[],[Node('application',pid=999)],[BadPid('application')],[Node('application',children=[Node('frame',children=[Node('document web',children=[Node('dialog')])])])],[Node('application',children=[Node('dialog')])]]
output=[]
for desktop in scenarios:
 api=types.SimpleNamespace(STATE_ACTIVE='ACTIVE',STATE_SHOWING='SHOWING',STATE_ENABLED='ENABLED',Registry=types.SimpleNamespace(getDesktop=lambda index:desktop))
 scan=module.native_dialogs(api,123);c=scan['counters']
 output.append({'apps':c['applications'],'owned':c['ownedApplications'],'pidErrors':c['processIdErrors'],'web':c['webSubtreesSkipped'],'dialogs':c['nativeDialogs'],'truncated':scan['truncated'],'counters':c})
print(json.dumps(output))
`, python], { encoding: 'utf8' }));
  assert.deepEqual(result.map(({ counters, ...summary }) => summary), [
    { apps: 0, owned: 0, pidErrors: 0, web: 0, dialogs: 0, truncated: false },
    { apps: 1, owned: 0, pidErrors: 0, web: 0, dialogs: 0, truncated: false },
    { apps: 1, owned: 0, pidErrors: 1, web: 0, dialogs: 0, truncated: false },
    { apps: 1, owned: 1, pidErrors: 0, web: 1, dialogs: 0, truncated: false },
    { apps: 1, owned: 1, pidErrors: 0, web: 0, dialogs: 1, truncated: false },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});


test('accessibility bus bootstrap sets and verifies IsEnabled and activates the same registry bus', async () => {
  const calls = [];
  const run = async (command, args, options) => {
    assert.equal(command, '/usr/bin/gdbus');assert.equal(options.timeout, 3000);calls.push(args);
    if (args.includes('org.freedesktop.DBus.Properties.Get')) return { stdout: '(<true>,)\n' };
    if (args.includes('org.a11y.Bus.GetAddress')) return { stdout: "('unix:path=/private/test-bus',)\n" };
    return { stdout: '()\n' };
  };
  assert.deepEqual(await prepareNativeAccessibilityBus(run), { status: 'ready', enabled: true, registryReachable: true });
  assert.deepEqual(calls[0].slice(-4), ['org.freedesktop.DBus.Properties.Set', 'org.a11y.Status', 'IsEnabled', '<true>']);
  assert.ok(calls[3].includes('--address') && calls[3].includes('unix:path=/private/test-bus'));
  for (const fail of ['disabled', 'no-address', 'registry']) {
    await assert.rejects(prepareNativeAccessibilityBus(async (_command, args) => {
      if (args.includes('org.freedesktop.DBus.Properties.Get')) return { stdout: fail === 'disabled' ? '(<false>,)' : '(<true>,)' };
      if (args.includes('org.a11y.Bus.GetAddress')) return { stdout: fail === 'no-address' ? '()' : "('unix:path=/private/test-bus',)" };
      if (args.includes('--address') && fail === 'registry') throw Error('private diagnostic');
      return { stdout: '()' };
    }), /NATIVE_ACCESSIBILITY_BUS_UNAVAILABLE/);
  }
});

test('only owned Chrome receives the native accessibility override without inherited headless suppression', () => {
  const original = { ACCESSIBILITY_ENABLED: '0', CHROME_HEADLESS: '1', OTHER: 'preserved' };
  assert.deepEqual(nativeAccessibilityEnvironment(original), { ACCESSIBILITY_ENABLED: '1', OTHER: 'preserved' });
  assert.equal(original.CHROME_HEADLESS, '1');assert.equal(original.ACCESSIBILITY_ENABLED, '0');
});

test('preflight reads native accessibility without invoking a permission action', async () => {
  const result = await probeNativeChromeAccessibility(123, async (command, args, options) => {
    assert.equal(command, '/usr/bin/python3');assert.ok(args.includes('--probe'));assert.equal(args.includes('--provider'), false);
    assert.equal(options.timeout, 7000);return { stdout: '{"status":"unavailable","reason":"native_ax_not_ready","scan":{"ownedApplications":0}}' };
  });
  assert.equal(result.status, 'unavailable');assert.equal(result.scan.ownedApplications, 0);
});

test('native preflight requires an owned active window and a showing non-web control', () => {
  const result = JSON.parse(execFileSync('/usr/bin/python3', ['-B', '-c', `
import importlib.util,json,sys,types
spec=importlib.util.spec_from_file_location('dialog',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
clock=[0.0];module.time.monotonic=lambda:clock[0];module.time.sleep=lambda seconds:clock.__setitem__(0,clock[0]+seconds)
class States:
 def __init__(self,active):self.active=active
 def contains(self,value):return value!='ACTIVE' or self.active
class Node:
 def __init__(self,role,children=(),active=True,pid=123):self.role=role;self.children=children;self.active=active;self.pid=pid;self.name=''
 def __iter__(self):return iter(self.children)
 def getRoleName(self):return self.role
 def getState(self):return States(self.active)
 def get_process_id(self):return self.pid
module.owned_process=lambda pid,owner:pid==owner
scenarios=[Node('application',[Node('frame',[Node('push button')])]),Node('application',[Node('frame',[Node('document web',[Node('push button')])])]),Node('application',[Node('frame',[Node('push button',active=False)],active=False)],active=False),Node('application',[Node('frame',[Node('push button')])],pid=999)]
results=[]
for app in scenarios:
 clock[0]=0
 api=types.SimpleNamespace(STATE_ACTIVE='ACTIVE',STATE_SHOWING='SHOWING',STATE_ENABLED='ENABLED',Registry=types.SimpleNamespace(getDesktop=lambda index:[app]))
 sys.modules['pyatspi']=api
 results.append(module.probe_native(123,1)['status'])
print(json.dumps(results))
`, python], { encoding: 'utf8' }));
  assert.deepEqual(result, ['ready', 'unavailable', 'unavailable', 'unavailable']);
});

test('semantic accessibility roles identify native buttons while excluding renamed web document roles', () => {
  const result = JSON.parse(execFileSync('/usr/bin/python3', ['-B', '-c', `
import importlib.util,json,sys,types
spec=importlib.util.spec_from_file_location('dialog',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class States:
 def contains(self,value):return True
class Action:
 nActions=1
 def getName(self,index):return 'click'
class Node:
 def __init__(self,role,name='',children=()):self.role=role;self.name=name;self.children=children
 def __iter__(self):return iter(self.children)
 def getRole(self):return self.role
 def getRoleName(self):return 'button' if self.role==43 else 'web document' if self.role==94 else 'alert' if self.role==2 else 'application'
 def getState(self):return States()
 def get_process_id(self):return 123
 def queryAction(self):return Action()
def dialog():return Node(2,'Geld permissions',[Node(1,'Read and change your data on gitlab.com'),Node(43,'Allow'),Node(43,'Cancel')])
app=Node(1,children=[dialog(),Node(94,children=[dialog()])])
api=types.SimpleNamespace(ROLE_PUSH_BUTTON=43,ROLE_DOCUMENT_WEB=94,ROLE_ALERT=2,STATE_ACTIVE='ACTIVE',STATE_SHOWING='SHOWING',STATE_ENABLED='ENABLED',Registry=types.SimpleNamespace(getDesktop=lambda index:[app]))
module.owned_process=lambda pid,owner:pid==owner
scan=module.native_dialogs(api,123)
print(json.dumps({'dialogs':len(scan['dialogs']),'qualifies':module.qualifies(scan['dialogs'][0][0],'gitlab',123),'web':scan['counters']['webSubtreesSkipped'],'roles':scan['counters']['reportedRoles']}))
`, python], { encoding: 'utf8' }));
  assert.equal(result.dialogs, 1);
  assert.equal(result.qualifies, true);
  assert.equal(result.web, 1);
  assert.equal(result.roles.button, 2);
});
