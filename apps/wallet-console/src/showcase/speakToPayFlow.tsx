import React from 'react';
import {
  functionCall,
  type ActionResult,
  type SpeakToSignEnrollmentResult,
  type SpeakToSignTransferResult,
} from '@seams/wallet';
import { useSeams } from '@seams/wallet/react';
import { CopyButton } from '@/components/CopyButton';
import { LoadingButton } from '@/components/LoadingButton';
import { HostedPasskeyLoginMenu } from '@/flows/demo/HostedPasskeyLoginMenu';
import { useDemoWalletSessionLifecycle } from '@/flows/demo/hooks/useDemoWalletSessionLifecycle';
import {
  CALL_GAS,
  CREATE_VAULT_DEPOSIT_YOCTO,
  DEFAULT_CONTACT,
  FAUCET_URL,
  PAYMENT_PREPAID_YOCTO,
  RECEIPT_BASE_URL,
  SETUP_NEED_YOCTO,
  VAULT,
  VAULT_TOP_UP_YOCTO,
  formatNear,
  parseSpokenAmount,
  readContacts,
  readFreeBalance,
  readVault,
  type VaultContact,
  type VaultView,
} from './speakToPayChain';
import {
  STAGE_LABELS,
  enrollmentRefusalText,
  errorMessage,
  formatSeconds,
  transferRefusalText,
  unavailableText,
} from './speakToPayText';

type Seams = ReturnType<typeof useSeams>['seams'];
type Availability = Awaited<ReturnType<Seams['registration']['getAuthMethodAvailability']>>;
type StepStatus = 'checking' | 'waiting' | 'todo' | 'working' | 'done' | 'failed';
type Loaded<T> =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'ready'; value: T }>
  | Readonly<{ kind: 'failed'; message: string }>;
type Outcome<T> =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'working' }>
  | Readonly<{ kind: 'result'; value: T }>
  | Readonly<{ kind: 'failed'; message: string }>;
type VaultState = Readonly<{ vault: VaultView | null; contacts: VaultContact[] }>;
type Owner = Readonly<{ seams: Seams; walletId: string; nearAccountId: string; rpcUrl: string }>;

const STATUS_LABELS: Record<StepStatus, string> = {
  checking: 'Checking',
  waiting: 'Waiting',
  todo: 'To do',
  working: 'In progress',
  done: 'Done',
  failed: 'Failed',
};

/** Runs `load` on mount and on each `reload`. It keeps the last value while it reloads. */
function useLoaded<T>(load: () => Promise<T>): [Loaded<T>, () => void] {
  const [state, setState] = React.useState<Loaded<T>>({ kind: 'loading' });
  const [round, setRound] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    load().then(
      (value) => live && setState({ kind: 'ready', value }),
      (error: unknown) => live && setState({ kind: 'failed', message: errorMessage(error) }),
    );
    return () => {
      live = false;
    };
  }, [load, round]);
  const reload = React.useCallback(() => setRound((value) => value + 1), []);
  return [state, reload];
}

/** Runs one owner action at a time and keeps its last result. */
function useOutcome<T>(): [Outcome<T>, (run: () => Promise<T>) => Promise<T | null>] {
  const [outcome, setOutcome] = React.useState<Outcome<T>>({ kind: 'idle' });
  const start = React.useCallback(async (run: () => Promise<T>) => {
    setOutcome({ kind: 'working' });
    try {
      const value = await run();
      setOutcome({ kind: 'result', value });
      return value;
    } catch (error: unknown) {
      setOutcome({ kind: 'failed', message: errorMessage(error) });
      return null;
    }
  }, []);
  return [outcome, start];
}

function StepCard(props: {
  index: number;
  title: string;
  status: StepStatus;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className="stp-step"
      data-status={props.status}
      aria-labelledby={`stp-step-${props.index}`}
    >
      <header className="stp-step__head">
        <span className="stp-step__index" aria-hidden>
          {props.index}
        </span>
        <h2 className="stp-step__title" id={`stp-step-${props.index}`}>
          {props.title}
        </h2>
        <span className="stp-pill" data-status={props.status}>
          {STATUS_LABELS[props.status]}
        </span>
      </header>
      <div className="stp-step__body">{props.children}</div>
    </section>
  );
}

function Notice(props: { tone: 'info' | 'error' | 'success'; children: React.ReactNode }) {
  return (
    <div
      className="stp-notice"
      data-tone={props.tone}
      role={props.tone === 'error' ? 'alert' : 'status'}
    >
      {props.children}
    </div>
  );
}

function ReceiptLink({ hash }: { hash: string }): React.JSX.Element {
  return (
    <a href={`${RECEIPT_BASE_URL}${hash}`} target="_blank" rel="noopener noreferrer">
      View the transaction on NearBlocks
    </a>
  );
}

function Fact(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="stp-fact">
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

/** A NEAR transaction that the SDK sent can still fail inside the contract. */
function contractFailure(result: ActionResult): string | null {
  if (!result.success) return result.error;
  const status: unknown = result.result?.status;
  if (status && typeof status === 'object' && 'Failure' in status) {
    return `The vault refused the call: ${JSON.stringify(status.Failure).slice(0, 300)}`;
  }
  return null;
}

async function callVault(
  owner: Owner,
  method: string,
  args: Record<string, unknown>,
  depositYocto: string,
): Promise<string> {
  const result = await owner.seams.near.signAndSendTransaction({
    walletSession: owner.walletId,
    nearAccount: owner.nearAccountId,
    receiverId: VAULT,
    actions: [functionCall({ method, args, gas: CALL_GAS, deposit: depositYocto })],
    options: {
      confirmationConfig: { uiMode: 'modal', behavior: 'requireClick' },
      waitUntil: 'FINAL',
    },
  });
  const failure = contractFailure(result);
  if (failure) throw new Error(failure);
  return result.transactionId ?? '';
}

function VoiceIdStep(props: {
  owner: Owner;
  availability: Loaded<Availability>;
  onChanged: () => void;
}): React.JSX.Element {
  const { owner, availability, onChanged } = props;
  const [outcome, start] = useOutcome<string>();
  const turnOn = React.useCallback(async () => {
    const current = availability.kind === 'ready' ? availability.value.kind : 'not_enrolled';
    await start(async () => {
      if (current === 'disabled') {
        await owner.seams.registration.setAuthMethodEnabled({
          walletId: owner.walletId,
          method: 'voiceid',
          enabled: true,
        });
        return 'VoiceID is on again.';
      }
      const result = await owner.seams.registration.activateAuthMethod({
        walletId: owner.walletId,
        method: 'voiceid',
      });
      return result.kind === 'activated'
        ? 'VoiceID is on.'
        : 'You closed the VoiceID window. Nothing changed.';
    });
    onChanged();
  }, [availability, onChanged, owner, start]);

  const status: StepStatus =
    outcome.kind === 'working'
      ? 'working'
      : availability.kind === 'loading'
        ? 'checking'
        : availability.kind === 'failed'
          ? 'failed'
          : availability.value.kind === 'enabled'
            ? 'done'
            : 'todo';

  return (
    <StepCard index={1} title="Turn on VoiceID" status={status}>
      {availability.kind === 'failed' ? <Notice tone="error">{availability.message}</Notice> : null}
      {status === 'done' ? (
        <p>VoiceID is on for this wallet. The Wallet uses it to record your spoken payments.</p>
      ) : (
        <>
          <p>
            Speak to pay records your voice in the VoiceID window of the Wallet. Turn on VoiceID
            first. The Wallet asks you to read a few short phrases.
          </p>
          <p className="stp-hint">
            You must be unlocked with your passkey. You can also turn on VoiceID in the account
            settings of the Wallet.
          </p>
          <LoadingButton
            onClick={turnOn}
            loading={outcome.kind === 'working'}
            loadingText="Waiting for VoiceID..."
            disabled={availability.kind !== 'ready'}
            style={{ width: '100%' }}
          >
            {availability.kind === 'ready' && availability.value.kind === 'disabled'
              ? 'Turn VoiceID on again'
              : 'Turn on VoiceID'}
          </LoadingButton>
        </>
      )}
      {outcome.kind === 'result' ? <Notice tone="info">{outcome.value}</Notice> : null}
      {outcome.kind === 'failed' ? <Notice tone="error">{outcome.message}</Notice> : null}
    </StepCard>
  );
}

function VaultStep(props: {
  owner: Owner;
  vault: Loaded<VaultState>;
  freeBalance: bigint | null;
  onChanged: () => void;
}): React.JSX.Element {
  const { owner, vault, freeBalance, onChanged } = props;
  const [contact, setContact] = React.useState(DEFAULT_CONTACT);
  const [outcome, start] = useOutcome<Readonly<{ message: string; hash: string }>>();
  const run = React.useCallback(
    async (message: string, method: string, args: Record<string, unknown>, deposit: string) => {
      await start(async () => ({ message, hash: await callVault(owner, method, args, deposit) }));
      onChanged();
    },
    [onChanged, owner, start],
  );
  const createVault = React.useCallback(
    () => run('Your vault exists now.', 'create_vault', {}, CREATE_VAULT_DEPOSIT_YOCTO),
    [run],
  );
  const addContact = React.useCallback(
    () =>
      run(
        `${contact.trim()} is a contact now.`,
        'add_contact',
        { account_id: contact.trim() },
        '0',
      ),
    [contact, run],
  );
  const topUp = React.useCallback(
    () => run('The vault has 0.1 NEAR more.', 'deposit', {}, VAULT_TOP_UP_YOCTO),
    [run],
  );

  const state = vault.kind === 'ready' ? vault.value : null;
  const active = state?.contacts.filter((item) => item.active) ?? [];
  const status: StepStatus =
    outcome.kind === 'working'
      ? 'working'
      : vault.kind === 'loading'
        ? 'checking'
        : vault.kind === 'failed'
          ? 'failed'
          : state?.vault && active.length > 0
            ? 'done'
            : 'todo';
  const tooPoorToCreate = freeBalance !== null && freeBalance < SETUP_NEED_YOCTO;
  const busy = outcome.kind === 'working';

  return (
    <StepCard index={2} title="Create your vault and add a contact" status={status}>
      {vault.kind === 'failed' ? <Notice tone="error">{vault.message}</Notice> : null}
      {state && !state.vault ? (
        <>
          <p>
            Spoken payments come from a vault on <code>{VAULT}</code>. Create your vault with a
            deposit of 0.15 NEAR. The vault keeps 0.1 NEAR for storage, and you can pay from the
            rest.
          </p>
          {tooPoorToCreate ? (
            <Notice tone="info">Your account needs about 0.3 NEAR first. See step 4.</Notice>
          ) : null}
          <LoadingButton
            onClick={createVault}
            loading={busy}
            loadingText="Waiting for the Wallet..."
            disabled={busy}
            style={{ width: '100%' }}
          >
            Create vault (0.15 NEAR)
          </LoadingButton>
        </>
      ) : null}
      {state?.vault ? (
        <>
          <dl className="stp-facts">
            <Fact label="Vault balance">{formatNear(state.vault.balanceYocto)}</Fact>
            <Fact label="Limit per payment">{formatNear(state.vault.perTransferYocto)}</Fact>
            <Fact label="Daily limit">{formatNear(state.vault.dailyYocto)}</Fact>
            <Fact label="Spent today">{formatNear(state.vault.spentTodayYocto)}</Fact>
          </dl>
          <p className="stp-hint">
            Each payment takes its amount and a small storage fee from the vault balance.
          </p>
          <h3 className="stp-subhead">Contacts</h3>
          {state.contacts.length ? (
            <ul className="stp-contacts">
              {state.contacts.map((item) => (
                <li key={item.accountId}>
                  <span>{item.accountId}</span>
                  <span className="stp-pill" data-status={item.active ? 'done' : 'waiting'}>
                    {item.active ? 'Active' : 'Not active yet'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>You have no contacts yet. A spoken payment can pay only an active contact.</p>
          )}
          <label className="stp-field">
            <span>Contact account</span>
            <input
              type="text"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
            />
          </label>
          <div className="stp-actions">
            <LoadingButton
              onClick={addContact}
              loading={busy}
              loadingText="Waiting for the Wallet..."
              disabled={busy || !contact.trim()}
            >
              Add contact
            </LoadingButton>
            <LoadingButton onClick={topUp} variant="secondary" disabled={busy}>
              Add 0.1 NEAR to the vault
            </LoadingButton>
          </div>
        </>
      ) : null}
      {outcome.kind === 'result' ? (
        <Notice tone="success">
          {outcome.value.message}{' '}
          {outcome.value.hash ? <ReceiptLink hash={outcome.value.hash} /> : null}
        </Notice>
      ) : null}
      {outcome.kind === 'failed' ? <Notice tone="error">{outcome.message}</Notice> : null}
    </StepCard>
  );
}

function EnrollmentResult({ result }: { result: SpeakToSignEnrollmentResult }): React.JSX.Element {
  switch (result.kind) {
    case 'enrolled':
      return (
        <Notice tone="success">
          The verifier stored your voice template. Template epoch {result.templateEpoch}, agreement{' '}
          {(result.agreementMilli / 1000).toFixed(3)}. <ReceiptLink hash={result.transactionHash} />
        </Notice>
      );
    case 'refused':
      return (
        <Notice tone="error">
          Refused (<code>{result.reason}</code>): {enrollmentRefusalText(result.reason)}
          {result.detail ? ` ${result.detail}` : ''}
        </Notice>
      );
    case 'cancelled':
      return <Notice tone="info">You closed the VoiceID window. Nothing was authorized.</Notice>;
    case 'unavailable':
      return (
        <Notice tone="error">
          Unavailable (<code>{result.reason}</code>): {unavailableText(result.reason)}
          {result.detail ? ` ${result.detail}` : ''}
        </Notice>
      );
  }
}

function EnrollStep(props: { owner: Owner; ready: boolean }): React.JSX.Element {
  const { owner, ready } = props;
  const [outcome, start] = useOutcome<SpeakToSignEnrollmentResult>();
  const enroll = React.useCallback(async () => {
    await start(async () => {
      const speakToSign = owner.seams.speakToSign;
      if (!speakToSign) throw new Error('Speak-to-Sign is not configured.');
      return await speakToSign.enroll({ walletId: owner.walletId });
    });
  }, [owner, start]);
  const status: StepStatus =
    outcome.kind === 'working'
      ? 'working'
      : outcome.kind === 'failed'
        ? 'failed'
        : outcome.kind === 'result'
          ? outcome.value.kind === 'enrolled'
            ? 'done'
            : outcome.value.kind === 'cancelled'
              ? 'todo'
              : 'failed'
          : ready
            ? 'todo'
            : 'waiting';

  return (
    <StepCard index={3} title="Enroll your voice" status={status}>
      <p>
        The verifier compares each payment with a template of your voice. The Wallet shows three
        short phrases, one at a time. Read each one aloud. Then confirm one{' '}
        <code>authorize_enrollment</code> call.
      </p>
      <p className="stp-hint">
        If you enrolled this wallet before, you can skip this step. A new enrollment replaces the
        template.
      </p>
      {!ready ? <Notice tone="info">Turn on VoiceID and create your vault first.</Notice> : null}
      <LoadingButton
        onClick={enroll}
        loading={outcome.kind === 'working'}
        loadingText="Enrolling..."
        disabled={!ready}
        style={{ width: '100%' }}
      >
        Enroll my voice
      </LoadingButton>
      {outcome.kind === 'result' ? <EnrollmentResult result={outcome.value} /> : null}
      {outcome.kind === 'failed' ? <Notice tone="error">{outcome.message}</Notice> : null}
    </StepCard>
  );
}

function BalanceStep(props: {
  owner: Owner;
  balance: Loaded<bigint | null>;
  hasVault: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  const { owner, balance, hasVault, onRefresh } = props;
  const need = hasVault ? PAYMENT_PREPAID_YOCTO : SETUP_NEED_YOCTO;
  const free = balance.kind === 'ready' ? balance.value : null;
  const status: StepStatus =
    balance.kind === 'loading'
      ? 'checking'
      : balance.kind === 'failed'
        ? 'failed'
        : free !== null && free >= need
          ? 'done'
          : 'todo';

  return (
    <StepCard index={4} title="Check your balance" status={status}>
      <dl className="stp-facts">
        <Fact label="NEAR account">
          <span className="stp-account">
            <code>{owner.nearAccountId}</code>
            <CopyButton text={owner.nearAccountId} ariaLabel="Copy the NEAR account" />
          </span>
        </Fact>
        <Fact label="Free balance">
          {balance.kind === 'ready'
            ? free === null
              ? 'This account is not on testnet yet'
              : formatNear(free)
            : balance.kind === 'failed'
              ? 'Unknown'
              : 'Checking...'}
        </Fact>
        <Fact label="You need">
          {hasVault ? 'About 0.051 NEAR for each payment' : 'About 0.3 NEAR'}
        </Fact>
      </dl>
      {balance.kind === 'failed' ? <Notice tone="error">{balance.message}</Notice> : null}
      <p className="stp-hint">
        Setup needs about 0.3 NEAR in total: create_vault takes 0.15 NEAR, and NEAR charges about
        0.03 NEAR of prepaid gas for each 30 Tgas call. Each spoken payment prepays about 0.051 NEAR
        of gas. NEAR returns the gas that a call does not use.
      </p>
      {status === 'todo' ? (
        <p>
          Copy your account, then get testnet NEAR from the{' '}
          <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
            NEAR testnet faucet
          </a>
          .
        </p>
      ) : null}
      <LoadingButton onClick={onRefresh} variant="secondary" style={{ width: '100%' }}>
        Check again
      </LoadingButton>
    </StepCard>
  );
}

function TransferResult({ result }: { result: SpeakToSignTransferResult }): React.JSX.Element {
  switch (result.kind) {
    case 'sent':
      return (
        <Notice tone="success">
          <p>
            The vault paid. <ReceiptLink hash={result.transactionHash} />
          </p>
          <dl className="stp-facts stp-facts--times">
            {STAGE_LABELS.map(([key, label]) => (
              <Fact key={key} label={label}>
                {formatSeconds(result.times[key])}
              </Fact>
            ))}
          </dl>
        </Notice>
      );
    case 'refused':
      return (
        <Notice tone="error">
          Refused (<code>{result.reason}</code>): {transferRefusalText(result.reason)}
          {result.detail ? ` ${result.detail}` : ''} Nothing was sent.
        </Notice>
      );
    case 'cancelled':
      return <Notice tone="info">You closed the VoiceID window. Nothing was sent.</Notice>;
    case 'unavailable':
      return (
        <Notice tone="error">
          Unavailable (<code>{result.reason}</code>): {unavailableText(result.reason)}
          {result.detail ? ` ${result.detail}` : ''}
        </Notice>
      );
  }
}

function PayStep(props: {
  owner: Owner;
  contacts: readonly VaultContact[];
  ready: boolean;
  onPaid: () => void;
}): React.JSX.Element {
  const { owner, ready, onPaid } = props;
  const active = props.contacts.filter((item) => item.active).map((item) => item.accountId);
  const [amountText, setAmountText] = React.useState('0.01');
  const [receiver, setReceiver] = React.useState('');
  const chosen = active.includes(receiver) ? receiver : (active[0] ?? '');
  const amount = parseSpokenAmount(amountText);
  const [outcome, start] = useOutcome<SpeakToSignTransferResult>();
  const pay = React.useCallback(async () => {
    const speakToSign = owner.seams.speakToSign;
    if (!speakToSign || !amount.ok || !chosen) return;
    const result = await start(() =>
      speakToSign.requestTransfer({
        walletId: owner.walletId,
        receiver: chosen,
        amount: amount.amount,
      }),
    );
    if (result?.kind === 'sent') onPaid();
  }, [amount, chosen, onPaid, owner, start]);
  const canPay = ready && amount.ok && Boolean(chosen) && outcome.kind !== 'working';
  const status: StepStatus =
    outcome.kind === 'working'
      ? 'working'
      : outcome.kind === 'failed'
        ? 'failed'
        : outcome.kind === 'result'
          ? outcome.value.kind === 'sent'
            ? 'done'
            : outcome.value.kind === 'cancelled'
              ? 'todo'
              : 'failed'
          : ready
            ? 'todo'
            : 'waiting';

  return (
    <StepCard index={5} title="Speak to pay" status={status}>
      {!ready ? (
        <Notice tone="info">Turn on VoiceID and add an active contact to your vault first.</Notice>
      ) : null}
      <div className="stp-row">
        <label className="stp-field">
          <span>Amount in NEAR</span>
          <input
            type="text"
            inputMode="decimal"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            aria-invalid={!amount.ok}
          />
        </label>
        <label className="stp-field">
          <span>Pay to</span>
          <select
            value={chosen}
            onChange={(event) => setReceiver(event.target.value)}
            disabled={!active.length}
          >
            {active.length ? null : <option value="">No active contact</option>}
            {active.map((accountId) => (
              <option key={accountId} value={accountId}>
                {accountId}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!amount.ok ? <p className="stp-field-error">{amount.message}</p> : null}
      <p>
        The VoiceID window shows the exact sentence, for example "Send 0.01 NEAR to
        seams-v1.testnet." Click Record, then read it aloud. In the account name, say "dash" for
        "-" and "dot" for ".".
      </p>
      <LoadingButton
        onClick={pay}
        loading={outcome.kind === 'working'}
        loadingText="Waiting for your voice..."
        disabled={!canPay}
        style={{ width: '100%' }}
      >
        Pay by voice
      </LoadingButton>
      {outcome.kind === 'result' ? <TransferResult result={outcome.value} /> : null}
      {outcome.kind === 'failed' ? <Notice tone="error">{outcome.message}</Notice> : null}
    </StepCard>
  );
}

function OwnerSteps({ owner }: { owner: Owner }): React.JSX.Element {
  const { seams, walletId, nearAccountId, rpcUrl } = owner;
  const loadAvailability = React.useCallback(
    () => seams.registration.getAuthMethodAvailability({ walletId, method: 'voiceid' }),
    [seams, walletId],
  );
  const loadVault = React.useCallback(async (): Promise<VaultState> => {
    const [vault, contacts] = await Promise.all([
      readVault(rpcUrl, nearAccountId),
      readContacts(rpcUrl, nearAccountId),
    ]);
    return { vault, contacts };
  }, [nearAccountId, rpcUrl]);
  const loadBalance = React.useCallback(
    () => readFreeBalance(rpcUrl, nearAccountId),
    [nearAccountId, rpcUrl],
  );
  const [availability, reloadAvailability] = useLoaded(loadAvailability);
  const [vault, reloadVault] = useLoaded(loadVault);
  const [balance, reloadBalance] = useLoaded(loadBalance);
  const reloadChain = React.useCallback(() => {
    reloadVault();
    reloadBalance();
  }, [reloadBalance, reloadVault]);

  const voiceIdOn = availability.kind === 'ready' && availability.value.kind === 'enabled';
  const vaultState = vault.kind === 'ready' ? vault.value : null;
  const hasVault = Boolean(vaultState?.vault);
  const contacts = vaultState?.contacts ?? [];
  const hasActiveContact = contacts.some((item) => item.active);

  return (
    <>
      <VoiceIdStep owner={owner} availability={availability} onChanged={reloadAvailability} />
      <VaultStep
        owner={owner}
        vault={vault}
        freeBalance={balance.kind === 'ready' ? balance.value : null}
        onChanged={reloadChain}
      />
      <EnrollStep owner={owner} ready={voiceIdOn && hasVault} />
      <BalanceStep owner={owner} balance={balance} hasVault={hasVault} onRefresh={reloadChain} />
      <PayStep
        owner={owner}
        contacts={contacts}
        ready={voiceIdOn && hasVault && hasActiveContact}
        onPaid={reloadChain}
      />
    </>
  );
}

/** The owner signs in, then walks through the five steps in order. */
export function SpeakToPayFlow({ rpcUrl }: { rpcUrl: string }): React.JSX.Element {
  const lifecycle = useDemoWalletSessionLifecycle();
  const { seams, loginState } = useSeams();
  const walletId =
    loginState.isLoggedIn && loginState.access === 'wallet' ? loginState.walletId : null;
  const nearAccountId = walletId ? loginState.nearAccountId : null;
  const owner = React.useMemo<Owner | null>(
    () => (walletId && nearAccountId ? { seams, walletId, nearAccountId, rpcUrl } : null),
    [nearAccountId, rpcUrl, seams, walletId],
  );

  if (lifecycle.kind === 'initialization_failed') {
    return <Notice tone="error">The Wallet did not load. Reload the page to try again.</Notice>;
  }
  if (!walletId) {
    return (
      <>
        <StepCard index={0} title="Sign in" status="todo">
          <p>Sign in to your Seams Wallet with your passkey. Then this page shows your setup.</p>
        </StepCard>
        <div className="stp-signin-menu">
          <HostedPasskeyLoginMenu defaultModeWhenNoDetectedAccount="login" />
        </div>
      </>
    );
  }
  if (!owner) {
    return (
      <Notice tone="info">
        The NEAR account of this wallet is not ready yet. Wait a moment, then reload the page.
      </Notice>
    );
  }
  return <OwnerSteps owner={owner} />;
}
