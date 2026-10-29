"""Verify a live Yao claim survives owner loss or a peer partition.

Usage: python3 google-yao.e2e.py RESOURCE_DIRECTORY WALLET_PACKAGE WALLET_CHECKOUT owner-loss|peer-partition|silent-partition|runtime-cycle
The task ledger supplies owned VMs, three buckets, SSH key and verified Linux runtime.
Both VMs are stopped after the run. No production resources or wallets are used.
"""

from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

source = Path(__file__).resolve()
repository = source.parents[3]
if len(sys.argv) != 5 or sys.argv[4] not in ('owner-loss', 'peer-partition', 'silent-partition', 'runtime-cycle'):
    raise SystemExit(__doc__)
ledger_directory, package, checkout = [Path(value).resolve() for value in sys.argv[1:4]]
scenario = sys.argv[4]
fault_kind = 'owner-loss' if scenario == 'runtime-cycle' else scenario
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
remote_directory = '/tmp/seams-celld-google-' + identifier
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
tunnel_addresses = {}
started = []
prepared_nodes = []
tagged = []
firewalls = []
partitioned = []
tag = 'r190-yao-' + identifier
result = {
    'status': 'running', 'stage': 'prepare', 'project': ledger['project'],
    'scenario': scenario, 'faultKind': fault_kind,
    'scope': 'A/B running claims on distinct Google nodes, held second protocol reply, bounded fault injection, burned-state recovery, and independent registration',
    'fleet': fleet, 'runtime': runtime, 'packageSha256': harness.directory_sha256(package),
    'manifestSha256': harness.sha256(package / 'artifact-manifest.json'),
    'publicRevision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout, text=True).strip(),
}
source_files = (
    source, source.with_name('google-runtime.remote.py'),
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



def stop_tunnel(process):
    mode = 'already-exited'
    if process.poll() is None:
        mode = 'process-group'
        try:
            harness.stop(process)
        except PermissionError:
            mode = 'managed-process-fallback'
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=8)
    assert process.poll() is not None, process.pid
    port = int(tunnel_addresses[process.pid].rsplit(':', 1)[1])
    for _ in range(20):
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                pass
        except ConnectionRefusedError:
            return {'pid': process.pid, 'returncode': process.returncode,
                    'mode': mode, 'forwardingPort': port, 'connectionRefused': True}
        time.sleep(0.1)
    raise RuntimeError('Owned SSH forwarding port is still listening: ' + str(port))


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
    nodes[0]['peerIp'] = nodes[1]['privateIp']
    nodes[1]['peerIp'] = nodes[0]['privateIp']
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
    proxy_config = json.loads((root / 'proxy.json').read_text())
    proxy_config['vars']['CONNECTION'] = 'hold-second-reply'
    harness.write_json(root / 'proxy.json', proxy_config)
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
        output.add(source.with_name('google-runtime.remote.py'), arcname=Path(remote_directory).name + '/remote.py')
    archive.chmod(0o600)
    result['deploymentArchiveSha256'] = harness.sha256(archive)
    for node in nodes:
        cloud(['compute', 'instances', 'add-tags', node['name'], '--project=' + ledger['project'],
               '--zone=' + node['zone'], '--tags=' + tag, '--quiet'], 'tag-' + node['kind'])
        tagged.append(node)
        cloud(['compute', 'scp', str(archive), node['name'] + ':' + remote_directory + '.tar.gz', *common(node)], 'upload-' + node['kind'])
        extract = 'umask 077; tar -xzf ' + shlex.quote(remote_directory + '.tar.gz') + ' -C /tmp'
        cloud(['compute', 'ssh', node['name'], *common(node), '--command=' + extract], 'extract-' + node['kind'])
        provider = dict(node, id=identifier, fleet=fleet, mapping=mapping, roles=roles,
                        faultKind=fault_kind, runtimeSha256=runtime['executableSha256'])
        if scenario == 'runtime-cycle':
            rollback = json.loads((ledger_directory / 'release-6/runtime-build.json').read_text())
            assert rollback['version'] == 'celld 0.6.2-seams.6'
            result['rollbackRuntime'] = rollback
            provider['rollbackRuntimeSha256'] = rollback['executableSha256']
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
        tunnel_addresses[tunnel.pid] = node['address']
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
    result['stage'] = 'create-tenant'
    credential = inputs['internalCredential']
    created = yao.post(address, 'ROUTER', '/router-ab/internal/tenant-root/creation/v1/create',
                       inputs['creation'], credential, addresses)
    assert created['status'] == 200 and created['body']['status']['kind'] == 'ready', created
    envelope = inputs['envelope']
    envelope['tenant_root']['custody_lineage_b64u'] = created['body']['custody_lineage_b64u']
    result['runtimeBeforeExecution'] = remote(nodes[0], 'runtime-state', 'runtime-before-execution')
    result['stage'] = 'hold-running-pair'
    with ThreadPoolExecutor(max_workers=1) as executor:
        execute_started = time.monotonic()
        pending = executor.submit(
            yao.post, address, 'ROUTER', '/router-ab/router/ed25519-yao/execute',
            envelope, inputs['gatewayCredential'], addresses,
        )
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            held = yao.read(address, 'PROXY', '/evidence')
            if held.get('heldSecondReply'):
                break
            assert not pending.done(), pending.result() if pending.done() else None
            time.sleep(0.1)
        assert held.get('heldSecondReply'), held
        assert held['connectionAttempts'] == 1 and held['connections'] == 1, held
        assert held['aMessages'] >= 1 and held['bMessages'] == 2, held
        assert not held['disconnected'] and not held['aClosed'] and not held['bClosed'], held
        execution = yao.read(address, 'CAPTURE', '/captured')
        assert execution is not None
        scope = {
            'wallet_route': execution['tenant_root']['wallet_route'],
            'ownership_generation': execution['tenant_root']['ownership_generation'],
            'root_identity': execution['tenant_root']['identity'],
            'pair_binding': execution['pair_binding'],
        }
        states = {}
        for role in ('deriver-a', 'deriver-b'):
            states[role] = yao.require_pair_state(
                address, role, scope, credential, addresses, 'running',
            )
        assert not pending.done(), 'Execution completed before owner-loss injection'
        result['activeClaimObservation'] = {
            'roleStates': states, 'connection': held, 'requestPendingBeforeFault': True,
        }
        if fault_kind == 'owner-loss':
            result['stage'] = 'kill-b-owner-during-execution'
            result['killedOwner'] = remote(nodes[1], 'kill', 'kill-b-owner')
            assert result['killedOwner']['afterSignal']['ExecMainStatus'] == '9'
            timing_field = 'signalUpperBoundMs'
        else:
            result['stage'] = 'partition-peers-during-execution'
            partitioned.append(nodes[0])
            result['partition'] = remote(nodes[0], 'partition-peer', 'partition-peer')
            if fault_kind == 'silent-partition':
                release = urllib.request.Request(address + '/PROXY/release', data=b'', method='POST')
                with urllib.request.urlopen(release, timeout=5) as response:
                    assert response.status == 200 and response.read() == b'released'
                result['heldReplyReleasedDuringPartition'] = True
            timing_field = 'partitionUpperBoundMs'
        fault_upper_bound_ms = (time.monotonic() - execute_started) * 1000
        result['activeClaimObservation'][timing_field] = fault_upper_bound_ms
        result['activeClaimObservation']['ceremonyTimeoutMs'] = 15_000
        assert fault_upper_bound_ms < 15_000, 'Fault was not confirmed before the ceremony timeout'
        first = pending.result(timeout=130)
        assert first['body'].get('status') != 'succeeded', first
        result['interruptedExecution'] = first
    interrupted = {
        'scope': scope, 'execution': execution, 'addresses': addresses,
        'credential': credential,
    }
    if fault_kind == 'owner-loss':
        result['bTakeover'] = yao.read_after_takeover(address, '', 'touch-b?id=' + addresses['deriver_b'])
        assert result['bTakeover']['evidence']['status'] == 404
        replacement = remote(nodes[0], 'owner', 'owner-after-takeover-b',
                             'RouterAbDeriverBWalletDurableObject', addresses['deriver_b'])
        assert replacement['nodeLease']['addr'] == nodes[0]['privateIp'] + ':19081'
        assert replacement['owner']['epoch'] > first_owners['b']['owner']['epoch']
        result['replacementOwner'] = replacement
    else:
        result['stage'] = 'observe-live-partition'
        try:
            yao.read(address, '', 'touch-b?id=' + addresses['deriver_b'])
        except urllib.error.HTTPError as error:
            body = error.read().decode()
            assert error.code == 500 and 'owner is currently unreachable' in body, (error.code, body)
            result['partitionRefusal'] = {'status': error.code, 'body': body}
        else:
            raise AssertionError('The partition did not refuse access to B')
        # Hold beyond the runtime's 10-second node lease and 15-second ceremony timeout.
        partition_confirmed = time.monotonic()
        time.sleep(20)
        result['partitionHeldMs'] = (time.monotonic() - partition_confirmed) * 1000
        result['aliveDuringPartition'] = {}
        result['ownersDuringPartition'] = {}
        for node, role in zip(nodes, ('a', 'b')):
            alive = remote(node, 'status', 'alive-during-partition-' + role)
            assert alive['MainPID'] == node['start']['state']['MainPID']
            assert alive['NRestarts'] == '0' and alive['ActiveState'] == 'active', alive
            result['aliveDuringPartition'][role] = alive
            owner = remote(nodes[0], 'owner', 'owner-during-partition-' + role,
                           'RouterAbDeriver' + role.upper() + 'WalletDurableObject',
                           addresses['deriver_' + role])
            assert owner['owner'] == first_owners[role]['owner'], owner
            assert owner['nodeLease']['expires_ms'] > first_owners[role]['nodeLease']['expires_ms']
            result['ownersDuringPartition'][role] = owner
        result['partitionCounters'] = remote(nodes[0], 'partition-status', 'partition-counters')
        assert result['partitionCounters']['active'] and result['partitionCounters']['packets'] > 0
        if fault_kind == 'silent-partition':
            progress = yao.read(address, 'PROXY', '/evidence')
            assert progress['releasedSecondReply'] and progress['aMessages'] > held['aMessages'], progress
            assert progress['bMessages'] == held['bMessages'], progress
            result['protocolDuringPartition'] = progress
        result['healedPartition'] = remote(nodes[0], 'heal-peer', 'heal-peer')
        partitioned.remove(nodes[0])
        healed = yao.read(address, '', 'touch-b?id=' + addresses['deriver_b'])
        assert healed['status'] == 404, healed
    yao.verify_burned_pair(address, interrupted, result)
    result['survivor'] = remote(nodes[0], 'status', 'survivor-status')
    assert result['survivor']['MainPID'] == nodes[0]['start']['state']['MainPID']
    assert result['survivor']['NRestarts'] == '0'
    result['stage'] = 'independent-wallet-after-fault'
    second = yao.post(address, 'ROUTER', '/router-ab/internal/tenant-root/creation/v1/create',
                      inputs['secondCreation'], credential, addresses)
    assert second['status'] == 200 and second['body']['status']['kind'] == 'ready', second
    independent = inputs['secondEnvelope']
    independent['tenant_root']['custody_lineage_b64u'] = second['body']['custody_lineage_b64u']
    independent_addresses = yao.read(address, '', 'addresses')
    if fault_kind != 'owner-loss':
        result['independentControlOwners'] = {}
        for node, role in zip(nodes, ('a', 'b')):
            touched = yao.read(node['address'], '', 'touch-' + role + '?id=' + independent_addresses['deriver_' + role])
            assert touched['status'] == 404, touched
            owner = remote(nodes[0], 'owner', 'owner-independent-' + role,
                           'RouterAbDeriver' + role.upper() + 'WalletDurableObject',
                           independent_addresses['deriver_' + role])
            assert owner['nodeLease']['addr'] == node['privateIp'] + ':19081', owner
            result['independentControlOwners'][role] = owner
    answer = yao.post(address, 'ROUTER', '/router-ab/router/ed25519-yao/execute',
                      independent, inputs['gatewayCredential'], independent_addresses)
    assert answer['status'] == 200 and answer['body']['status'] == 'succeeded', answer
    result['independentWalletCompletedAfterFault'] = True
    result['runtimeAfterControl'] = remote(nodes[0], 'runtime-state', 'runtime-after-control')
    if scenario == 'runtime-cycle':
        result['runtimeCycle'] = []
        previous_owner = result['replacementOwner']['owner']
        for checkpoint, action in (('rollback', 'start-rollback'), ('upgrade', 'start')):
            result['stage'] = checkpoint
            stopped = remote(nodes[0], 'stop', checkpoint + '-stop')
            assert stopped['after']['ExecMainStatus'] == '0', stopped
            assert stopped['after']['Result'] == 'success', stopped
            launched = remote(nodes[0], action, checkpoint + '-start')
            assert launched['state']['MainPID'] != stopped['before']['MainPID']
            observed = {'checkpoint': checkpoint, 'stop': stopped, 'start': launched}
            yao.verify_burned_pair(address, interrupted, observed)
            owner = remote(nodes[0], 'owner', checkpoint + '-owner-b',
                           'RouterAbDeriverBWalletDurableObject', addresses['deriver_b'])
            assert owner['owner']['epoch'] >= previous_owner['epoch'], owner
            assert owner['nodeLease']['addr'] == nodes[0]['privateIp'] + ':19081'
            observed['owner'] = owner
            previous_owner = owner['owner']
            replay = yao.post(address, 'ROUTER', '/router-ab/internal/tenant-root/creation/v1/create',
                              inputs['secondCreation'], credential, independent_addresses)
            expected_replay = dict(second['body'])
            expected_replay['replayed'] = True
            assert replay['status'] == 200 and replay['body'] == expected_replay, replay
            observed['tenantRootCreationReplayPreserved'] = True
            result['runtimeCycle'].append(observed)
    for file in source_files:
        assert result['sourceHashes'][file.name] == harness.sha256(file), file.name
    result['status'] = 'passed'
except (Exception, KeyboardInterrupt) as error:
    result['status'] = 'failed'
    result['error'] = repr(error)
    harness.write_json(root / 'failure.json', result)
    raise
finally:
    cleanup_errors = []
    for node in partitioned:
        try:
            node['partitionCleanup'] = remote(node, 'heal-peer', 'cleanup-partition-' + node['kind'])
        except Exception as error:
            cleanup_errors.append(repr(error))
    for node in reversed(started):
        try:
            node['cleanup'] = remote(node, 'stop', 'stop-' + node['kind'])
            cloud(['compute', 'scp', node['name'] + ':' + remote_directory + '/runtime.log',
                   str(root / (node['kind'] + '-runtime.log')), *common(node)], 'runtime-log-' + node['kind'])
            runtime_log = (root / (node['kind'] + '-runtime.log')).read_text()
            assert 'shutdown_handoff_stalled' not in runtime_log, (
                node['kind'] + ' runtime did not drain successfully'
            )
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
    result['tunnelCleanup'] = []
    for process in reversed(processes):
        try:
            result['tunnelCleanup'].append(stop_tunnel(process))
        except Exception as error:
            cleanup_errors.append({'pid': process.pid, 'error': repr(error)})
    result['cleanupErrors'] = cleanup_errors
    if cleanup_errors:
        result['status'] = 'failed'
    harness.write_json(root / 'result.json', result)
    print(json.dumps({'status': result['status'], 'stage': result['stage'], 'error': result.get('error'), 'cleanupErrors': cleanup_errors}), flush=True)

if result['status'] != 'passed':
    raise SystemExit(1)
