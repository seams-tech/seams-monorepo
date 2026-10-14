"""Operate one task-owned celld process and read its fleet ownership records."""

import hashlib
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
assert str(root).startswith('/tmp/r190-google-yao-')
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


def start():
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
        str(binary), '--no-control-plane', '--listen', '127.0.0.1:19080',
        '--internal-listen', inputs['privateIp'] + ':19081',
        '--advertise', inputs['privateIp'] + ':19081',
    ])
    subprocess.run(command, check=True, capture_output=True, text=True)
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
    assert (process / 'cmdline').read_bytes().split(b'\0')[0].decode() == str(binary)
    return {'state': current, 'runtimeSha256': inputs['runtimeSha256'], 'watch': str(root / 'state')}


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
    result = start()
elif action == 'stop':
    result = stop(False)
elif action == 'kill':
    result = stop(True)
elif action == 'status':
    result = state()
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
