"""Operate one task-owned celld process and read its fleet ownership records."""

import hashlib
import ipaddress
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request

root = Path(sys.argv[1])
assert str(root).startswith('/tmp/seams-celld-google-')
inputs = json.loads((root / 'provider.json').read_text())
binary = Path('/opt/seams/celld')
assert hashlib.sha256(binary.read_bytes()).hexdigest() == inputs['runtimeSha256']
unit = 'r190-yao-' + inputs['id'] + '-' + inputs['kind'] + '.service'
environment = {
    'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'RUST_LOG': 'warn',
    'CELLD_BUCKET': inputs['fleet'], 'CELLD_R2_BUCKETS': json.dumps(inputs['mapping']),
    'CELLD_WATCH': str(root / 'state'), 'CELLD_DEPLOY_POLL_S': '1',
}
properties = ['Id', 'MainPID', 'ActiveState', 'SubState', 'Result', 'NRestarts',
              'ExecMainPID', 'ExecMainCode', 'ExecMainStatus', 'ExecMainStartTimestamp']


def state():
    command = ['systemctl', 'show', unit, '--property=' + ','.join(properties)]
    output = subprocess.check_output(command, text=True)
    return dict(line.split('=', 1) for line in output.splitlines() if '=' in line)


def cli(arguments, label):
    with (root / (label + '.log')).open('w') as output:
        subprocess.run([str(binary), *arguments], cwd=root, env=environment,
                       stdout=output, stderr=subprocess.STDOUT, check=True, timeout=180)


def start(executable, expected_hash):
    assert hashlib.sha256(executable.read_bytes()).hexdigest() == expected_hash
    failed = subprocess.run(
        ['systemctl', 'is-failed', unit], capture_output=True, text=True,
    )
    if failed.returncode == 0:
        assert state()['MainPID'] == '0'
        subprocess.run(
            ['sudo', 'systemctl', 'reset-failed', unit],
            check=True, capture_output=True, text=True,
        )
    (root / 'state').mkdir(exist_ok=True)
    log = root / 'runtime.log'
    log.touch()
    log.chmod(0o600)
    command = [
        'sudo', 'systemd-run', '--unit=' + unit, '--property=Type=exec',
        '--property=User=' + os.environ['USER'], '--property=Restart=no',
        '--property=KillMode=control-group', '--property=WorkingDirectory=' + str(root),
        '--property=StandardOutput=append:' + str(log), '--property=StandardError=inherit',
    ]
    command.extend('--setenv=' + key + '=' + value for key, value in environment.items())
    command.extend([
        str(executable), '--no-control-plane', '--listen', '127.0.0.1:19080',
        '--internal-listen', inputs['privateIp'] + ':19081',
        '--advertise', inputs['privateIp'] + ':19081',
        '--trust-forwarded-headers',
    ])
    with (root / 'start-unit.log').open('a') as output:
        subprocess.run(command, check=True, stdout=output, stderr=subprocess.STDOUT, text=True)
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        current = state()
        assert current['ActiveState'] != 'failed', current
        try:
            with urllib.request.urlopen('http://127.0.0.1:19080/.well-known/celld/health', timeout=5) as reply:
                if reply.status == 200:
                    break
        except OSError:
            time.sleep(0.2)
    else:
        raise RuntimeError('Native process readiness timed out')
    process = Path('/proc') / current['MainPID']
    assert (process / 'cwd').resolve() == root
    assert (process / 'cmdline').read_bytes().split(b'\0')[0].decode() == str(executable)
    assert hashlib.sha256((process / 'exe').read_bytes()).hexdigest() == expected_hash
    return {'state': current, 'runtimeSha256': expected_hash, 'watch': str(root / 'state')}


def stop(force):
    before = state()
    if force and before['MainPID'] != '0':
        subprocess.run(['sudo', 'systemctl', 'kill', '--signal=SIGKILL', unit], check=True)
        deadline = time.monotonic() + 15
        while state()['MainPID'] != '0' and time.monotonic() < deadline:
            time.sleep(0.1)
    after_signal = state()
    subprocess.run(['sudo', 'systemctl', 'stop', unit], check=True)
    after = state()
    assert after['MainPID'] == '0' and after['ActiveState'] in ('inactive', 'failed'), after
    return {'before': before, 'afterSignal': after_signal, 'after': after}


def owner(class_name, identifier):
    assert class_name in ('RouterAbDeriverAWalletDurableObject', 'RouterAbDeriverBWalletDurableObject')
    assert len(identifier) == 64 and all(char in '0123456789abcdef' for char in identifier)
    request = urllib.request.Request(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        headers={'Metadata-Flavor': 'Google'},
    )
    with urllib.request.urlopen(request, timeout=5) as reply:
        token = json.loads(reply.read())['access_token']
    bucket, prefix = inputs['fleet'].removeprefix('gs://').split('/', 1)
    scope = class_name + ':' + identifier
    record = storage_object(bucket, prefix + '/cells/' + scope + '/own.json', token)
    lease = storage_object(bucket, prefix + '/nodes/' + record['node'] + '.json', token)
    return {'scope': scope, 'owner': record, 'nodeLease': lease}


def storage_object(bucket, key, token):
    url = 'https://storage.googleapis.com/storage/v1/b/' + bucket + '/o/' + urllib.parse.quote(key, safe='') + '?alt=media'
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(request, timeout=30) as reply:
        return json.loads(reply.read())


def firewall(arguments, check=True):
    return subprocess.run(
        ['sudo', 'iptables', '--wait', '5', *arguments],
        check=check, capture_output=True, text=True,
    )


def partition_status():
    chain = 'r190-yao-' + inputs['id']
    rules = firewall(['-L', chain, '-n', '-v', '-x'], check=False)
    if rules.returncode == 1:
        return {'active': False}
    rules.check_returncode()
    packets = 0
    for line in rules.stdout.splitlines():
        columns = line.split()
        if columns and columns[0].isdigit():
            packets += int(columns[0])
    linked = firewall(['-C', 'OUTPUT', '-j', chain], check=False)
    assert linked.returncode in (0, 1), linked.stderr
    return {'active': linked.returncode == 0, 'packets': packets, 'rules': rules.stdout}


def partition_peer():
    peer = inputs['peerIp']
    assert ipaddress.ip_address(peer).is_private and peer != inputs['privateIp']
    before = state()
    assert before['ActiveState'] == 'active' and before['MainPID'] != '0', before
    sockets = []
    for port in ('dport', 'sport'):
        sockets.append(subprocess.check_output(
            ['sudo', 'ss', '-Hntp', 'dst', peer, port, '=', '19081'], text=True,
        ))
    assert any('pid=' + before['MainPID'] + ',' in row for row in sockets), sockets
    assert inputs['faultKind'] in ('peer-partition', 'silent-partition')
    verdict = ['-j', 'REJECT', '--reject-with', 'tcp-reset']
    if inputs['faultKind'] == 'silent-partition':
        verdict = ['-j', 'DROP']
    chain = 'r190-yao-' + inputs['id']
    firewall(['-N', chain])
    for port in ('--dport', '--sport'):
        firewall(['-A', chain, '-p', 'tcp', '-d', peer, port, '19081', *verdict])
    firewall(['-I', 'OUTPUT', '1', '-j', chain])
    closed = []
    if inputs['faultKind'] == 'peer-partition':
        for port in ('dport', 'sport'):
            closed.append(subprocess.check_output(
                ['sudo', 'ss', '-K', 'dst', peer, port, '=', '19081'], text=True,
            ))
    result = partition_status()
    assert result['active']
    result.update({'peer': peer, 'runtimeBefore': before, 'socketsBefore': sockets,
                   'closedSockets': closed})
    return result


def heal_peer():
    before = partition_status()
    chain = 'r190-yao-' + inputs['id']
    if before['active']:
        firewall(['-D', 'OUTPUT', '-j', chain])
    exists = firewall(['-L', chain], check=False)
    assert exists.returncode in (0, 1), exists.stderr
    if exists.returncode == 0:
        firewall(['-F', chain])
        firewall(['-X', chain])
    after = partition_status()
    assert not after['active'], after
    return {'before': before, 'after': after}


action = sys.argv[2]
if action == 'deploy':
    for role in inputs['roles']:
        cli(['deploy', 'rendered/' + role + '/wrangler.json'], 'deploy-' + role)
    result = {'deployed': inputs['roles']}
elif action == 'migrate':
    for role in inputs['roles']:
        relative = 'rendered/' + role + '/wrangler.json'
        config = json.loads((root / relative).read_text())
        for database in config.get('d1_databases', []):
            cli(['d1', 'migrations', 'apply', database['database_name'], relative], 'migrate-' + role)
    result = {'migrated': True}
elif action == 'start':
    result = start(binary, inputs['runtimeSha256'])
elif action == 'start-rollback':
    result = start(Path('/opt/seams/celld.seams6'), inputs['rollbackRuntimeSha256'])
elif action == 'stop':
    result = stop(False)
elif action == 'kill':
    result = stop(True)
elif action == 'status':
    result = state()
elif action == 'partition-peer':
    result = partition_peer()
elif action == 'partition-status':
    result = partition_status()
elif action == 'heal-peer':
    result = heal_peer()
elif action == 'runtime-state':
    with urllib.request.urlopen('http://' + inputs['privateIp'] + ':19081/state', timeout=10) as reply:
        snapshot = json.loads(reply.read())
    result = {key: snapshot[key] for key in ('residents', 'node_load')}
elif action == 'console-count':
    sql = sys.argv[3]
    assert sql.startswith('SELECT COUNT(*) AS count FROM ')
    output = subprocess.check_output([
        str(binary), 'd1', 'execute', 'console-celld-acceptance',
        'rendered/console/wrangler.json', '--command', sql, '--json',
    ], cwd=root, env=environment, text=True)
    rows = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
    assert len(rows) == 1 and set(rows[0]) == {'count'}, output
    assert type(rows[0]['count']) is int and rows[0]['count'] >= 0
    result = rows[0]
elif action == 'collect':
    archive = root / 'diagnostics.tar.gz'
    logs = sorted(root.glob('*.log'))
    with tarfile.open(archive, 'w:gz') as output:
        for log in logs:
            output.add(log, arcname=log.name)
    archive.chmod(0o600)
    result = {'files': [log.name for log in logs], 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
elif action == 'owner':
    result = owner(sys.argv[3], sys.argv[4])
else:
    raise ValueError(action)
print(json.dumps(result), flush=True)
