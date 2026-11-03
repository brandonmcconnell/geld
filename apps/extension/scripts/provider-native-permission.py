"""Confirm one owned Chrome permission dialog, never a web-page prompt."""
import argparse
import json
import re
import time
from itertools import islice

HOSTS = {
    'gitlab': {'gitlab.com'},
    'bitbucket': {'bitbucket.org', 'api.bitbucket.org'},
}
WEB_ROLES = {'document web', 'document frame', 'html container', 'embedded'}
ACTION_NAMES = {'click', 'press'}


def qualifies(dialog, provider, owned_pid):
    expected = HOSTS[provider]
    text = dialog.get('text', '')
    hosts = set(re.findall(r'(?<![\w.-])([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?![\w.-])', text.lower()))
    buttons = dialog.get('buttons', [])
    allow = [button for button in buttons if button.get('name') == 'Allow']
    cancel = [button for button in buttons if button.get('name') in {'Cancel', "Don't allow", 'Deny'}]
    return (dialog.get('owned_pid') == owned_pid and dialog.get('native') is True and dialog.get('truncated') is not True
            and dialog.get('role') in {'dialog', 'alert'} and dialog.get('showing') is True
            and dialog.get('active') is True and re.search(r'\bGeld\b', text) is not None
            and hosts == expected and not re.search(r'\ball (?:websites|sites)\b', text, re.I)
            and len(allow) == 1 and allow[0].get('enabled') is True and allow[0].get('showing') is True
            and bool(set(allow[0].get('actions', [])) & ACTION_NAMES)
            and len(cancel) == 1)


def owned_process(pid, browser_pid):
    for _ in range(32):
        if pid == browser_pid:
            return True
        if pid <= 1:
            return False
        try:
            with open(f'/proc/{pid}/status', encoding='utf-8') as source:
                match = re.search(r'^PPid:\s*(\d+)$', source.read(), re.M)
            if match is None:
                return False
            pid = int(match.group(1))
        except OSError:
            return False
    return False


def native_dialogs(atspi, browser_pid):
    found = []
    truncated = False
    desktop = atspi.Registry.getDesktop(0)
    applications = list(islice(iter(desktop), 65))
    if len(applications) > 64:
        return {'dialogs': [], 'truncated': True}
    for app in applications:
        try:
            if not owned_process(app.get_process_id(), browser_pid):
                continue
        except Exception:
            continue
        pending = [(app, False, False, 0)]
        inspected = 0
        while pending and inspected < 4096:
            node, web, active, depth = pending.pop()
            inspected += 1
            try:
                role = node.getRoleName()
                web = web or role in WEB_ROLES
                if web:
                    continue
                if depth > 24:
                    truncated = True
                    continue
                states = node.getState()
                active = active or states.contains(atspi.STATE_ACTIVE)
                if role in {'dialog', 'alert'}:
                    text, buttons, handles = [], [], []
                    children = [(node, 0)]
                    visited = 0
                    incomplete = False
                    while children and visited < 2048 and len(text) < 256:
                        child, child_depth = children.pop()
                        visited += 1
                        if child_depth > 16:
                            incomplete = True
                            continue
                        child_role = child.getRoleName()
                        if child_role in WEB_ROLES:
                            continue
                        name = child.name or ''
                        if name:
                            if len(name) > 1024:
                                incomplete = True
                            text.append(name[:1024])
                        if child_role == 'push button':
                            child_states = child.getState()
                            try:
                                action = child.queryAction()
                                actions = [action.getName(index) for index in range(action.nActions)]
                            except Exception:
                                actions = []
                            buttons.append({'name': name, 'enabled': child_states.contains(atspi.STATE_ENABLED),
                                            'showing': child_states.contains(atspi.STATE_SHOWING), 'actions': actions})
                            handles.append(child)
                        descendants = list(islice(iter(child), 65))
                        if len(descendants) > 64:
                            incomplete = True
                        children.extend((descendant, child_depth + 1) for descendant in descendants[:64])
                    record = {'owned_pid': browser_pid, 'native': True, 'role': role, 'name': node.name or '',
                              'text': '\n'.join(text), 'active': active, 'showing': states.contains(atspi.STATE_SHOWING),
                              'buttons': buttons, 'truncated': incomplete or bool(children)}
                    found.append((record, handles))
                descendants = list(islice(iter(node), 65))
                if len(descendants) > 64:
                    truncated = True
                pending.extend((child, web, active, depth + 1) for child in descendants[:64])
            except Exception:
                truncated = True
                continue
        if pending:
            truncated = True
    return {'dialogs': found, 'truncated': truncated}


def diagnostic(record, provider):
    buttons = record.get('buttons', [])
    seen_hosts = set(re.findall(r'(?<![\w.-])([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?![\w.-])', record.get('text', '').lower()))
    allow = [button for button in buttons if button.get('name') == 'Allow']
    cancel = [button for button in buttons if button.get('name') in {'Cancel', "Don't allow", 'Deny'}]
    return {'role': record.get('role'), 'geldNamed': re.search(r'\bGeld\b', record.get('text', '')) is not None,
            'owned': record.get('native') is True, 'truncated': record.get('truncated') is True, 'showing': record.get('showing'), 'active': record.get('active'),
            'expectedHostsSeen': sorted(HOSTS[provider] & seen_hosts),
            'allowCount': len(allow), 'cancelCount': len(cancel), 'otherButtonCount': len(buttons) - len(allow) - len(cancel),
            'allowEnabled': len(allow) == 1 and allow[0].get('enabled') is True,
            'allowShowing': len(allow) == 1 and allow[0].get('showing') is True,
            'nativeActions': sorted({action for button in allow for action in button.get('actions', []) if action in ACTION_NAMES})}


def confirm(provider, browser_pid, deadline):
    import pyatspi
    end = time.monotonic() + deadline
    previous = None
    last = []
    while time.monotonic() < end:
        scan = native_dialogs(pyatspi, browser_pid)
        dialogs = scan['dialogs']
        last = [diagnostic(record, provider) for record, _ in dialogs if re.search(r'\bGeld\b', record.get('text', ''))][:8]
        if scan['truncated'] or any(record.get('truncated') for record, _ in dialogs):
            return {'status': 'unavailable', 'reason': 'native_tree_truncated', 'dialogs': last}
        candidates = [(record, handles) for record, handles in dialogs if qualifies(record, provider, browser_pid)]
        if len(candidates) > 1:
            return {'status': 'unavailable', 'reason': 'ambiguous_native_dialog', 'dialogs': last}
        if len(candidates) == 1:
            record, handles = candidates[0]
            signature = json.dumps(record, sort_keys=True)
            if signature == previous:
                allow = handles[next(index for index, button in enumerate(record['buttons']) if button['name'] == 'Allow')]
                action = allow.queryAction()
                indexes = [index for index in range(action.nActions) if action.getName(index) in ACTION_NAMES]
                if len(indexes) != 1 or not action.doAction(indexes[0]):
                    return {'status': 'unavailable', 'reason': 'native_allow_action_failed', 'dialogs': last}
                return {'status': 'confirmed', 'provider': provider, 'method': 'owned_native_atspi_allow',
                        'dialog': diagnostic(record, provider)}
            previous = signature
        else:
            previous = None
        time.sleep(0.1)
    return {'status': 'unavailable', 'reason': 'qualified_native_dialog_not_found', 'dialogs': last}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--provider', required=True, choices=HOSTS)
    parser.add_argument('--browser-pid', required=True, type=int)
    parser.add_argument('--seconds', default=10, type=int)
    args = parser.parse_args()
    if args.browser_pid <= 1 or not 1 <= args.seconds <= 15:
        parser.error('Invalid owned browser or deadline')
    try:
        result = confirm(args.provider, args.browser_pid, args.seconds)
    except Exception:
        result = {'status': 'unavailable', 'reason': 'atspi_unavailable'}
    print(json.dumps(result))
