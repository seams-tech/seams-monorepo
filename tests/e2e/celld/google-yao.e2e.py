"""Verify a real interrupted Yao pair across two Google nodes and B-owner loss.

Usage: python3 google-yao.e2e.py RESOURCE_DIRECTORY WALLET_PACKAGE WALLET_CHECKOUT
The task ledger supplies owned VMs, three buckets, SSH key and verified Linux runtime.
Both VMs are stopped after the run. No production resources or wallets are used.
"""

import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

source = Path(__file__).resolve()
repository = source.parents[3]
ledger_directory, package, checkout = [Path(value).resolve() for value in sys.argv[1:]]
ledger = json.loads((ledger_directory / 'resources.json').read_text())
assert ledger['project'] == 'seams-501403'
runtime = json.loads((ledger_directory / 'runtime-build.json').read_text())
spec = importlib.util.spec_from_file_location('yao', source.with_name('yao-peer-disconnect.e2e.py'))
yao = importlib.util.module_from_spec(spec)
spec.loader.exec_module(yao)
harness = yao.harness
root = Path(tempfile.mkdtemp(prefix='google-yao-', dir=ledger_directory))
root.chmod(0o700)
identifier = root.name.removeprefix('google-yao-').replace('_', '-')
remote_directory = '/tmp/r190-google-yao-' + identifier
fleet = 'gs://' + ledger['buckets']['fleet'] + '/yao-' + identifier
nodes = [
    {'kind': 'ordinary', 'name': ledger['ordinaryVm'], 'zone': ledger['zone']},
    {'kind': 'confidential', 'name': ledger['confidentialVm'], 'zone': ledger['confidentialZone']},
]
environment = {
    'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'],
    'TMPDIR': os.environ.get('TMPDIR', '/tmp'),
    'NODE_PATH': str(repository / 'node_modules'),
    'ROUTER_AB_WORKER_BUILD_PROFILE': 'release',
}
processes = []
started = []
prepared_nodes = []
tagged = []
firewalls = []
tag = 'r190-yao-' + identifier
result = {
    'status': 'running', 'stage': 'prepare', 'project': ledger['project'],
    'scope': 'real Yao interruption with measured A/B ownership on distinct Google nodes; B-owner SIGKILL and burned-pair takeover',
    'fleet': fleet, 'runtime': runtime, 'packageSha256': harness.directory_sha256(package),
    'manifestSha256': harness.sha256(package / 'artifact-manifest.json'),
    'publicRevision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout, text=True).strip(),
}
source_files = (
    source, source.with_name('google-yao.remote.py'),
    source.with_name('yao-peer-disconnect.e2e.py'), source.with_name('prepare-yao.mjs'),
    source.with_name('packaged-wallet.e2e.py'), source.with_name('prepare-wallet.mjs'),
    repository / 'deployment/celld/render.mjs',
    checkout / 'crates/router-ab-cloudflare/scripts/yao-peer-disconnect-proxy.mjs',
    checkout / 'crates/router-ab-cloudflare/scripts/test-private-d1.mjs',
    checkout / 'crates/router-ab-dev/examples/cloudflare_private_d1_fixture.rs',
)
(root / 'sources').mkdir(mode=0o700)
result['sourceHashes'] = {file.name: harness.sha256(file) for file in source_files}
for file in source_files:
    shutil.copyfile(file, root / 'sources' / file.name)
print(root, flush=True)


def cloud(arguments, label, timeout=300):
    path = root / (label + '.log')
    with path.open('w') as output:
        subprocess.run(['gcloud', *arguments], stdout=output, stderr=subprocess.STDOUT,
                       check=True, timeout=timeout)
    return path


def common(node):
    return ['--project=' + ledger['project'], '--zone=' + node['zone'],
            '--ssh-key-file=' + str(ledger_directory / 'ssh-key'), '--quiet']


def remote(node, action, label, *arguments):
    command = shlex.join(['python3', remote_directory + '/remote.py', remote_directory, action, *arguments])
    path = cloud(['compute', 'ssh', node['name'], *common(node), '--command=' + command], label)
    records = [json.loads(line) for line in path.read_text().splitlines() if line.startswith('{')]
    assert len(records) == 1, (label, len(records))
    return records[0]


def fresh_grant(label):
    command = [
        'cargo', 'run', '--quiet', '--locked', '--manifest-path',
        str(checkout / 'crates/router-ab-dev/Cargo.toml'),
        '--example', 'cloudflare_private_d1_fixture', '--', '--creation-grant', label, '300000',
    ]
    path = root / ('grant-' + label + '.json')
    with path.open('w') as output, (root / ('grant-' + label + '.log')).open('w') as errors:
        subprocess.run(command, cwd=checkout, env=environment, stdout=output,
                       stderr=errors, check=True, timeout=180)
    path.chmod(0o600)
    return json.loads(path.read_text())


def ready(address, process):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('Owned SSH tunnel stopped before readiness')
        try:
            if harness.response(address + '/.well-known/celld/health')['status'] == 200:
                return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError('Google runtime readiness timed out')


try:
    cloud(['compute', 'instances', 'start', *(node['name'] for node in nodes),
           '--project=' + ledger['project'], '--zone=us-central1-c', '--quiet'], 'start-vms')
    for node in nodes:
        path = cloud(['compute', 'instances', 'describe', node['name'],
                      '--project=' + ledger['project'], '--zone=' + node['zone'],
                      '--format=json(name,networkInterfaces,machineType,cpuPlatform,confidentialInstanceConfig,status)'],
                     'instance-' + node['kind'])
        instance = json.loads(path.read_text())
        assert instance['status'] == 'RUNNING'
        node['privateIp'] = instance['networkInterfaces'][0]['networkIP']
        node['machine'] = {key: instance[key] for key in ('machineType', 'cpuPlatform', 'confidentialInstanceConfig') if key in instance}
    result['nodes'] = nodes
    endpoint = 'http://127.0.0.1:' + str(harness.free_port())
    environment['SEAMS_LOCAL_PORT_OFFSET'] = str(int(endpoint.rsplit(':', 1)[1]) - 4100)
    setup = source.with_name('prepare-wallet.mjs')
    harness.run(['node', setup, package, root, endpoint, 'http://localhost:4201', 'http://localhost:4202'],
                root, environment, 'prepare.log')
    prepared = json.loads((root / 'prepared.json').read_text())
    manifest, configs, mapping = harness.prepare(package, root, prepared)
    harness.run(['node', source.with_name('prepare-yao.mjs'), root, checkout],
                root, environment, 'prepare-yao.log', timeout=240)
    proxy = root / 'yao-proxy.mjs'
    proxy_source = proxy.read_text()
    refusal_record = 'evidence.refusals.push({ status: response.status, reason });'
    assert refusal_record in proxy_source
    proxy.write_text(proxy_source.replace(
        refusal_record, 'evidence.refusals.push({ status: response.status, reason, body });',
    ))
    roles = [*configs, 'proxy', 'capture', 'order', 'observer']
    services = []
    for role, config in configs.items():
        services.append({'binding': role.upper().replace('-', '_'), 'service': config['name']})
    services.extend([
        {'binding': 'CAPTURE', 'service': 'yao-execution-capture'},
        {'binding': 'PROXY', 'service': 'yao-connection-proxy'},
    ])
    observer = harness.OBSERVER.replace(
        "const role = url.pathname.split('/')[1];",
        """if (url.pathname === '/addresses') return Response.json({
      router: env.ROUTER_WALLET.newUniqueId().toString(),
      deriver_a: env.DERIVER_A_WALLET.newUniqueId().toString(),
      deriver_b: env.DERIVER_B_WALLET.newUniqueId().toString(),
      signing_worker: env.SIGNING_WORKER_WALLET.newUniqueId().toString()
    });
    if (url.pathname === '/touch-a' || url.pathname === '/touch-b') {
      const id = url.searchParams.get('id');
      const binding = url.pathname === '/touch-a' ? env.DERIVER_A_WALLET : env.DERIVER_B_WALLET;
      const response = await binding.get(binding.idFromString(id)).fetch('https://operator.test/unhandled-ownership-probe');
      return Response.json({status:response.status});
    }
    const role = url.pathname.split('/')[1];""",
    )
    (root / 'observer.mjs').write_text(observer)
    object_bindings = []
    for role, binding, class_name in (
        ('router', 'ROUTER_WALLET', 'RouterAbRouterWalletDurableObject'),
        ('deriver-a', 'DERIVER_A_WALLET', 'RouterAbDeriverAWalletDurableObject'),
        ('deriver-b', 'DERIVER_B_WALLET', 'RouterAbDeriverBWalletDurableObject'),
        ('signing-worker', 'SIGNING_WORKER_WALLET', 'RouterAbSigningWorkerWalletDurableObject'),
    ):
        object_bindings.append({'name': binding, 'class_name': class_name, 'script_name': configs[role]['name']})
    harness.write_json(root / 'observer.json', {
        'name': 'yao-observer', 'main': 'observer.mjs', 'compatibility_date': '2026-06-12',
        'services': services, 'durable_objects': {'bindings': object_bindings},
    })
    (root / 'empty-secrets.json').write_text('{}\n')
    (root / 'rendered').mkdir(mode=0o700)
    for role in roles:
        harness.run(['node', repository / 'deployment/celld/render.mjs', root / (role + '.json'),
                     root / 'empty-secrets.json', root / 'rendered' / role], root, environment, 'render-' + role + '.log')
    mapping = {
        key: 'gs://' + ledger['buckets']['backup-a' if value.endswith('deriver-a') else 'backup-b']
        for key, value in mapping.items()
    }
    assert len(set(mapping.values())) == 2
    result['backupBuckets'] = mapping
    result['renderedHashes'] = {
        str(file.relative_to(root / 'rendered')): harness.sha256(file)
        for file in sorted((root / 'rendered').rglob('*')) if file.is_file()
    }
    allow, deny = tag + '-allow', tag + '-deny'
    cloud(['compute', 'firewall-rules', 'create', allow, '--project=' + ledger['project'],
           '--network=default', '--priority=900', '--allow=tcp:19081', '--target-tags=' + tag,
           '--source-ranges=' + ','.join(node['privateIp'] + '/32' for node in nodes), '--quiet'], 'firewall-allow')
    firewalls.append(allow)
    cloud(['compute', 'firewall-rules', 'create', deny, '--project=' + ledger['project'],
           '--network=default', '--priority=1000', '--action=DENY', '--rules=tcp:19081',
           '--target-tags=' + tag, '--source-ranges=0.0.0.0/0', '--quiet'], 'firewall-deny')
    firewalls.append(deny)
    archive = root / 'deployment.tar.gz'
    with tarfile.open(archive, 'w:gz') as output:
        output.add(root / 'rendered', arcname=Path(remote_directory).name + '/rendered')
        output.add(source.with_name('google-yao.remote.py'), arcname=Path(remote_directory).name + '/remote.py')
    archive.chmod(0o600)
    result['deploymentArchiveSha256'] = harness.sha256(archive)
    for node in nodes:
        cloud(['compute', 'instances', 'add-tags', node['name'], '--project=' + ledger['project'],
               '--zone=' + node['zone'], '--tags=' + tag, '--quiet'], 'tag-' + node['kind'])
        tagged.append(node)
        cloud(['compute', 'scp', str(archive), node['name'] + ':' + remote_directory + '.tar.gz', *common(node)], 'upload-' + node['kind'])
        extract = 'umask 077; tar -xzf ' + shlex.quote(remote_directory + '.tar.gz') + ' -C /tmp'
        cloud(['compute', 'ssh', node['name'], *common(node), '--command=' + extract], 'extract-' + node['kind'])
        provider = dict(node, id=identifier, fleet=fleet, mapping=mapping, roles=roles, runtimeSha256=runtime['executableSha256'])
        provider_path = root / (node['kind'] + '-provider.json')
        harness.write_json(provider_path, provider)
        provider_path.chmod(0o600)
        cloud(['compute', 'scp', str(provider_path), node['name'] + ':' + remote_directory + '/provider.json', *common(node)], 'provider-' + node['kind'])
        prepared_nodes.append(node)
    result['stage'] = 'deploy-google'
    remote(nodes[0], 'deploy', 'deploy')
    for node in nodes:
        started.append(node)
        node['start'] = remote(node, 'start', 'start-' + node['kind'])
        port = harness.free_port()
        node['address'] = 'http://127.0.0.1:' + str(port)
        tunnel = harness.start(['gcloud', 'compute', 'ssh', node['name'], *common(node), '--',
                                '-N', '-o', 'ExitOnForwardFailure=yes', '-L', str(port) + ':127.0.0.1:19080'],
                               root, environment, 'tunnel-' + node['kind'] + '.log', processes)
        ready(node['address'], tunnel)
    remote(nodes[0], 'migrate', 'migrate')
    address = nodes[0]['address']
    addresses = yao.read(address, '', 'addresses')
    for node, role in zip(nodes, ('a', 'b')):
        touched = yao.read(node['address'], '', 'touch-' + role + '?id=' + addresses['deriver_' + role])
        assert touched['status'] == 404, touched
    first_owners = {}
    for role in ('a', 'b'):
        first_owners[role] = remote(nodes[0], 'owner', 'owner-before-' + role,
                                    'RouterAbDeriver' + role.upper() + 'WalletDurableObject', addresses['deriver_' + role])
    assert first_owners['a']['nodeLease']['addr'] == nodes[0]['privateIp'] + ':19081'
    assert first_owners['b']['nodeLease']['addr'] == nodes[1]['privateIp'] + ':19081'
    result['ownersBeforeFault'] = first_owners
    inputs = json.loads((root / 'yao-inputs.json').read_text())
    for label, creation_key, envelope_key in (
        ('primary', 'creation', 'envelope'), ('independent', 'secondCreation', 'secondEnvelope'),
    ):
        grant = fresh_grant(identifier + '-' + label)
        inputs[creation_key] = {'creation_grant_b64u': grant['creation_grant_b64u']}
        inputs[envelope_key]['tenant_root']['identity'] = grant['identity']
    interrupted = yao.verify_disconnect(address, inputs, addresses, result)
    result['ownersAfterFault'] = {}
    for role in ('a', 'b'):
        after_fault = remote(nodes[0], 'owner', 'owner-after-fault-' + role,
                             'RouterAbDeriver' + role.upper() + 'WalletDurableObject', addresses['deriver_' + role])
        assert after_fault['owner'] == first_owners[role]['owner']
        result['ownersAfterFault'][role] = after_fault
    result['stage'] = 'kill-b-owner'
    result['killedOwner'] = remote(nodes[1], 'kill', 'kill-b-owner')
    assert result['killedOwner']['afterSignal']['ExecMainStatus'] == '9'
    result['bTakeover'] = yao.read_after_takeover(address, '', 'touch-b?id=' + addresses['deriver_b'])
    assert result['bTakeover']['evidence']['status'] == 404
    yao.verify_burned_pair(address, interrupted, result)
    replacement = remote(nodes[0], 'owner', 'owner-after-takeover-b',
                         'RouterAbDeriverBWalletDurableObject', addresses['deriver_b'])
    assert replacement['nodeLease']['addr'] == nodes[0]['privateIp'] + ':19081'
    assert replacement['owner']['epoch'] > first_owners['b']['owner']['epoch']
    result['replacementOwner'] = replacement
    result['survivor'] = remote(nodes[0], 'status', 'survivor-status')
    assert result['survivor']['MainPID'] == nodes[0]['start']['state']['MainPID']
    assert result['survivor']['NRestarts'] == '0'
    result['status'] = 'passed'
except Exception as error:
    result['status'] = 'failed'
    result['error'] = repr(error)
    harness.write_json(root / 'failure.json', result)
    raise
finally:
    cleanup_errors = []
    for node in reversed(started):
        try:
            node['cleanup'] = remote(node, 'stop', 'stop-' + node['kind'])
            cloud(['compute', 'scp', node['name'] + ':' + remote_directory + '/runtime.log',
                   str(root / (node['kind'] + '-runtime.log')), *common(node)], 'runtime-log-' + node['kind'])
        except Exception as error:
            cleanup_errors.append(repr(error))
    for node in prepared_nodes:
        try:
            node['diagnostics'] = remote(node, 'collect', 'collect-' + node['kind'])
            destination = root / (node['kind'] + '-diagnostics.tar.gz')
            cloud(['compute', 'scp', node['name'] + ':' + remote_directory + '/diagnostics.tar.gz',
                   str(destination), *common(node)], 'download-diagnostics-' + node['kind'])
            assert harness.sha256(destination) == node['diagnostics']['sha256']
        except Exception as error:
            cleanup_errors.append(repr(error))
    for process in reversed(processes):
        try:
            harness.stop(process)
        except Exception as error:
            cleanup_errors.append({'pid': process.pid, 'error': repr(error)})
    for rule in firewalls:
        try:
            cloud(['compute', 'firewall-rules', 'delete', rule, '--project=' + ledger['project'], '--quiet'], 'delete-' + rule)
        except Exception as error:
            cleanup_errors.append(repr(error))
    for node in tagged:
        try:
            cloud(['compute', 'instances', 'remove-tags', node['name'], '--project=' + ledger['project'],
                   '--zone=' + node['zone'], '--tags=' + tag, '--quiet'], 'untag-' + node['kind'])
        except Exception as error:
            cleanup_errors.append(repr(error))
    try:
        cloud(['compute', 'instances', 'stop', *(node['name'] for node in nodes),
               '--project=' + ledger['project'], '--zone=us-central1-c', '--quiet'], 'stop-vms')
        for node in nodes:
            path = cloud(['compute', 'instances', 'describe', node['name'],
                          '--project=' + ledger['project'], '--zone=' + node['zone'],
                          '--format=json(name,status,tags.items)'], 'final-' + node['kind'])
            node['final'] = json.loads(path.read_text())
            assert node['final']['status'] == 'TERMINATED'
            assert tag not in node['final'].get('tags', {}).get('items', [])
        path = cloud(['compute', 'firewall-rules', 'list', '--project=' + ledger['project'],
                      '--filter=name~^' + tag + '-', '--format=json(name)'], 'final-firewalls')
        result['remainingPeerRules'] = json.loads(path.read_text())
        assert result['remainingPeerRules'] == []
    except Exception as error:
        cleanup_errors.append(repr(error))
    result['cleanupErrors'] = cleanup_errors
    if cleanup_errors:
        result['status'] = 'failed'
    harness.write_json(root / 'result.json', result)
    print(json.dumps({'status': result['status'], 'stage': result['stage'], 'error': result.get('error'), 'cleanupErrors': cleanup_errors}), flush=True)

if result['status'] != 'passed':
    raise SystemExit(1)
