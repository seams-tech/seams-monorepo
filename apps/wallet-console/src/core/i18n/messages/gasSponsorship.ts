import type { Entry } from '../entry';

export const gasSponsorshipMessages = {
  // Page chrome and aria labels
  gasPageLabel: { en: 'Gas sponsorship page', ja: 'ガス代スポンサーページ' },
  gasErrorLabel: { en: 'Gas sponsorship error', ja: 'ガス代スポンサーのエラー' },
  gasReadinessLabel: {
    en: 'Gas sponsorship balance readiness',
    ja: 'ガス代スポンサーの残高状況',
  },
  gasReadinessMetricsLabel: {
    en: 'Gas sponsorship balance readiness metrics',
    ja: 'ガス代スポンサーの残高状況の指標',
  },
  gasPoliciesLabel: { en: 'Gas sponsorship policies', ja: 'ガス代スポンサーポリシー' },
  gasRowsLabel: { en: 'Gas sponsorship rows', ja: 'ガス代スポンサーポリシーの行' },
  gasModalCreateLabel: {
    en: 'Create gas sponsorship policy modal',
    ja: 'ガス代スポンサーポリシーの作成モーダル',
  },
  gasModalEditLabel: {
    en: 'Edit gas sponsorship policy modal',
    ja: 'ガス代スポンサーポリシーの編集モーダル',
  },
  gasModalViewLabel: {
    en: 'View gas sponsorship coverage modal',
    ja: 'ガス代スポンサーの対象範囲モーダル',
  },

  // Loading, errors and shared notices
  gasLoadingPolicies: {
    en: 'Loading gas sponsorship policies...',
    ja: 'ガス代スポンサーポリシーを読み込んでいます…',
  },
  gasSessionUnavailable: {
    en: 'Console session is unavailable',
    ja: 'Consoleセッションを利用できません',
  },
  gasUnauthorized: { en: 'unauthorized', ja: '権限がありません' },
  gasDataUnavailableSession: {
    en: 'Gas sponsorship data unavailable: {reason}.',
    ja: 'ガス代スポンサーのデータを利用できません: {reason}。',
  },
  gasDataUnavailable: {
    en: 'Gas sponsorship data unavailable: {reason}',
    ja: 'ガス代スポンサーのデータを利用できません: {reason}',
  },
  gasAccessRequired: {
    en: 'Owner, administrator, or project editor access is required.',
    ja: 'オーナー、管理者、またはプロジェクト編集者の権限が必要です。',
  },
  gasDraftRestored: { en: 'Restored unsaved draft.', ja: '未保存の下書きを復元しました。' },
  gasPolicyUpdated: {
    en: 'Gas sponsorship policy updated.',
    ja: 'ガス代スポンサーポリシーを更新しました。',
  },
  gasPolicyCreated: {
    en: 'Gas sponsorship policy created.',
    ja: 'ガス代スポンサーポリシーを作成しました。',
  },
  gasConfirmDiscardDraft: {
    en: 'Discard this unsaved draft?',
    ja: 'この未保存の下書きを破棄しますか？',
  },
  gasConfirmDeletePolicy: {
    en: 'Delete gas sponsorship policy "{name}"? This cannot be undone.',
    ja: 'ガス代スポンサーポリシー「{name}」を削除しますか？この操作は元に戻せません。',
  },
  gasToastEnabled: { en: '{name} enabled.', ja: '{name}を有効にしました。' },
  gasToastDisabled: { en: '{name} disabled.', ja: '{name}を無効にしました。' },
  gasToastDeleted: { en: '{name} deleted.', ja: '{name}を削除しました。' },

  // Validation messages
  gasErrIntNonNegative: {
    en: '{field} must be a non-negative integer.',
    ja: '{field}は0以上の整数で入力してください。',
  },
  gasErrGreaterThanZero: {
    en: '{field} must be greater than zero.',
    ja: '{field}は0より大きい値にしてください。',
  },
  gasErrSpendCapAmount: {
    en: '{field} must be a non-negative amount with up to {decimals} decimal places.',
    ja: '{field}は小数点以下{decimals}桁までの0以上の金額で入力してください。',
  },
  gasErrChooseTarget: {
    en: 'Choose at least one chain target.',
    ja: 'チェーンターゲットを1つ以上選択してください。',
  },
  gasErrProjectScope: {
    en: 'Project scope requires a project ID.',
    ja: 'プロジェクトスコープにはプロジェクトIDが必要です。',
  },
  gasErrEnvironmentScope: {
    en: 'Environment scope requires an environment ID.',
    ja: '環境スコープには環境IDが必要です。',
  },
  gasErrPolicyScope: {
    en: 'Policy scope requires a policy ID.',
    ja: 'ポリシースコープにはポリシーIDが必要です。',
  },
  gasErrWalletSegmentScope: {
    en: 'Wallet segment scope requires a wallet segment ID.',
    ja: 'ウォレットセグメントスコープにはウォレットセグメントIDが必要です。',
  },
  gasErrNearCapTarget: {
    en: 'NEAR spend cap target is unavailable for {network}.',
    ja: '{network}ではNEARの支出上限ターゲットを利用できません。',
  },
  gasErrAddContract: {
    en: 'Add at least one allowed contract.',
    ja: '許可するコントラクトを1つ以上追加してください。',
  },
  gasErrContractAddress: {
    en: 'Allowed contract must be a valid EVM address.',
    ja: '許可するコントラクトは有効なEVMアドレスにしてください。',
  },
  gasErrContractNeedsFunction: {
    en: 'Each allowed contract needs at least one function.',
    ja: '許可する各コントラクトには、関数が1つ以上必要です。',
  },
  gasErrFunctionSignature: {
    en: 'Allowed function must be a function signature like transfer(address,uint256).',
    ja: '許可する関数は、transfer(address,uint256)のような関数シグネチャにしてください。',
  },
  gasErrAddDelegateAction: {
    en: 'Add at least one allowed delegate action.',
    ja: '許可するデリゲートアクションを1つ以上追加してください。',
  },
  gasErrReceiverRequired: {
    en: 'Delegate action receiver ID is required.',
    ja: 'デリゲートアクションのレシーバーIDは必須です。',
  },

  // Field names used inside validation messages and aria labels
  gasFieldSpendCap: { en: '{chain} spend cap', ja: '{chain}の支出上限' },
  gasFieldMaxGasLimit: { en: '{signature} max gas limit', ja: '{signature}の最大ガスリミット' },
  gasFieldMaxValue: { en: '{signature} max value', ja: '{signature}の最大値' },
  gasFieldMaxDeposit: { en: '{receiver} max deposit', ja: '{receiver}の最大デポジット' },

  // Summaries
  gasNoChainTargets: { en: 'No chain targets', ja: 'チェーンターゲットなし' },
  gasChainTargetsMore: { en: '{labels} +{count} more', ja: '{labels} ほか{count}件' },
  gasChainFallback: { en: 'Chain {chainId}', ja: 'チェーン {chainId}' },
  gasEnvDevelopment: { en: 'development', ja: '開発' },
  gasEnvProduction: { en: 'production', ja: '本番' },
  gasEnvStaging: { en: 'staging', ja: 'ステージング' },
  gasUnitsFallback: { en: 'units', ja: '単位' },
  gasSpendCapNone: { en: 'No spend cap', ja: '支出上限なし' },
  gasSpendCapPerChain: { en: 'Per chain total', ja: 'チェーンごとの合計' },
  gasSpendCapPerWalletChain: { en: 'Per wallet, per chain', ja: 'ウォレットごと、チェーンごと' },
  gasCapScopeTotal: { en: 'total', ja: '合計' },
  gasCapScopePerWallet: { en: 'per wallet', ja: 'ウォレットごと' },
  gasPeriodWeeklyInline: { en: 'weekly', ja: '週次' },
  gasPeriodMonthlyInline: { en: 'monthly', ja: '月次' },
  gasPeriodWeekly: { en: 'WEEKLY', ja: '週次' },
  gasPeriodMonthly: { en: 'MONTHLY', ja: '月次' },
  gasCapCoverageEntry: {
    en: '{chain} {period} cap {amount} {scope}',
    ja: '{chain}の{period}上限 {amount}（{scope}）',
  },
  gasSpendCapModePeriod: { en: '{mode} ({period})', ja: '{mode}（{period}）' },
  gasSpendCapMultiple: {
    en: '{count} {period} caps · {mode}',
    ja: '{period}上限 {count}件 · {mode}',
  },
  gasAllowedFunctionSummary: {
    en: '{signature} · gas <= {gas} · value <= {value} wei',
    ja: '{signature} · ガス ≤ {gas} · 値 ≤ {value} wei',
  },
  gasAnyMethod: { en: 'any method', ja: '任意のメソッド' },
  gasTransfersAllowed: { en: 'allowed', ja: '許可' },
  gasTransfersBlocked: { en: 'blocked', ja: '禁止' },
  gasDelegateActionSummary: {
    en: '{receiver} · {methods} · deposit <= {deposit} yocto · transfers {transfers}',
    ja: '{receiver} · {methods} · デポジット ≤ {deposit} yocto · 送金: {transfers}',
  },
  gasNoDelegateActionAllowed: {
    en: 'No allowed delegate action',
    ja: '許可されたデリゲートアクションなし',
  },
  gasDelegateActionCountOne: {
    en: '{count} delegate action',
    ja: 'デリゲートアクション {count}件',
  },
  gasDelegateActionCountOther: {
    en: '{count} delegate actions',
    ja: 'デリゲートアクション {count}件',
  },
  gasNoAllowedCallRule: { en: 'No allowed-call rule', ja: '許可された呼び出しルールなし' },
  gasContractCountOne: { en: '{count} contract', ja: 'コントラクト {count}件' },
  gasContractCountOther: { en: '{count} contracts', ja: 'コントラクト {count}件' },
  gasFunctionCountOne: { en: '{count} function', ja: '関数 {count}件' },
  gasFunctionCountOther: { en: '{count} functions', ja: '関数 {count}件' },
  gasNetworkMainnet: { en: 'Mainnet', ja: 'メインネット' },
  gasNetworkTestnet: { en: 'Testnet', ja: 'テストネット' },
  gasNetworkAny: { en: 'Any network', ja: 'すべてのネットワーク' },
  gasEnabled: { en: 'Enabled', ja: '有効' },
  gasDisabled: { en: 'Disabled', ja: '無効' },
  gasAllMainnets: { en: 'All mainnets', ja: 'すべてのメインネット' },
  gasAllTestnets: { en: 'All testnets', ja: 'すべてのテストネット' },
  gasPolicyItem: { en: 'policy', ja: 'ポリシー' },
  gasPolicyItemPlural: { en: 'policies', ja: 'ポリシー' },

  // Balance readiness
  gasBalanceOrgPrepaid: { en: 'Org prepaid balance', ja: '組織のプリペイド残高' },
  gasBalanceBlockedHint: {
    en: 'Sponsorship is blocked until balance is positive again',
    ja: '残高がプラスに戻るまでスポンサーはブロックされます',
  },
  gasBalanceWarningHint: {
    en: 'Warning threshold {amount}',
    ja: '警告しきい値 {amount}',
  },
  gasBalanceHealthyHint: {
    en: 'Positive balance available for sponsorship admission',
    ja: 'スポンサーの受け付けに使える残高があります',
  },
  gasBalanceReserved: { en: 'Reserved funds', ja: '予約済み資金' },
  gasReservationsOne: { en: '{count} active reservation', ja: '有効な予約 {count}件' },
  gasReservationsOther: { en: '{count} active reservations', ja: '有効な予約 {count}件' },
  gasBalanceSpend30: { en: '30-day sponsored spend', ja: '30日間のスポンサー支出' },
  gasRecentExecutionsOne: {
    en: '{count} recent sponsored execution',
    ja: '最近のスポンサー付き実行 {count}件',
  },
  gasRecentExecutionsOther: {
    en: '{count} recent sponsored executions',
    ja: '最近のスポンサー付き実行 {count}件',
  },
  gasBalanceSpend90: { en: '90-day sponsored spend', ja: '90日間のスポンサー支出' },
  gasLookbackExecutionsOne: {
    en: '{count} execution over the full lookback',
    ja: '集計期間全体で実行 {count}件',
  },
  gasLookbackExecutionsOther: {
    en: '{count} executions over the full lookback',
    ja: '集計期間全体で実行 {count}件',
  },
  gasNoticeDepleted: {
    en: 'Sponsored execution is currently blocked because org prepaid balance is depleted. Policy caps can still have room, but no new sponsored requests will be admitted until the balance is refilled.',
    ja: '組織のプリペイド残高がなくなったため、スポンサー付き実行は現在ブロックされています。ポリシーの上限に余裕があっても、残高が補充されるまで新しいスポンサーリクエストは受け付けられません。',
  },
  gasNoticeLow: {
    en: 'Sponsored execution is still active, but prepaid balance is at or below the warning threshold ({threshold}). Refill before live traffic pushes the org into blocked state.',
    ja: 'スポンサー付き実行は引き続き有効ですが、プリペイド残高が警告しきい値（{threshold}）以下です。本番トラフィックで組織がブロック状態になる前に、残高を補充してください。',
  },
  gasReadinessTitle: { en: 'Sponsorship balance readiness', ja: 'スポンサー残高の状況' },
  gasReadinessIntro: {
    en: 'Policy configuration and prepaid balance are separate controls. Even with enabled policies, sponsorship stops immediately when the organization balance is exhausted.',
    ja: 'ポリシー設定とプリペイド残高は別々の制御です。ポリシーが有効でも、組織の残高が尽きるとスポンサーはただちに停止します。',
  },
  gasLoadingBalance: {
    en: 'Loading sponsorship balance state...',
    ja: 'スポンサー残高の状況を読み込んでいます…',
  },
  gasBalanceUnavailable: {
    en: 'Sponsorship balance state unavailable: {reason}',
    ja: 'スポンサー残高の状況を利用できません: {reason}',
  },
  gasTopUp: { en: 'Top up balance', ja: '残高をチャージ' },
  gasOpenBilling: { en: 'Open billing', ja: '請求を開く' },

  // Policies table
  gasPolicies: { en: 'Policies', ja: 'ポリシー' },
  gasCreatePolicy: { en: 'Create policy', ja: 'ポリシーを作成' },
  gasPolicy: { en: 'Policy', ja: 'ポリシー' },
  gasBehavior: { en: 'Behavior', ja: '動作' },
  gasSpendCap: { en: 'Spend cap', ja: '支出上限' },
  gasUpdated: { en: 'Updated', ja: '更新日時' },
  gasActions: { en: 'Actions', ja: '操作' },
  gasNoPolicies: {
    en: 'No gas sponsorship policies found for this environment yet.',
    ja: 'この環境にはガス代スポンサーポリシーがまだありません。',
  },
  gasView: { en: 'View', ja: '表示' },
  gasMoreActionsFor: { en: 'More actions for {name}', ja: '{name}のその他の操作' },
  gasEdit: { en: 'Edit', ja: '編集' },
  gasDisable: { en: 'Disable', ja: '無効にする' },
  gasEnable: { en: 'Enable', ja: '有効にする' },
  gasDelete: { en: 'Delete', ja: '削除' },
  gasHistoryScope: {
    en: 'Showing the selected Wallet environment ({environmentId}).',
    ja: '選択中のWallet環境（{environmentId}）を表示しています。',
  },

  // Coverage modal
  gasCoverage: { en: 'Coverage', ja: '対象範囲' },
  gasSelectedPolicyFallback: {
    en: 'Selected sponsorship policy',
    ja: '選択したスポンサーポリシー',
  },
  gasEnvironment: { en: 'Environment', ja: '環境' },
  gasScopeProject: { en: 'project: {name}', ja: 'プロジェクト: {name}' },
  gasScopeEnvironment: { en: 'environment: {name}', ja: '環境: {name}' },
  gasStatus: { en: 'Status', ja: 'ステータス' },
  gasDelegateActions: { en: 'Delegate actions', ja: 'デリゲートアクション' },
  gasRules: { en: 'Rules', ja: 'ルール' },
  gasExecutionMode: { en: 'Execution mode', ja: '実行モード' },
  gasPolicyBehavior: { en: 'Policy behavior', ja: 'ポリシーの動作' },
  gasContractCalls: { en: 'Contract calls', ja: 'コントラクト呼び出し' },
  gasNoDelegateRules: {
    en: 'No delegate-action rules configured.',
    ja: 'デリゲートアクションのルールが設定されていません。',
  },
  gasNoAllowedCallRules: {
    en: 'No allowed-call rules configured.',
    ja: '許可された呼び出しルールが設定されていません。',
  },
  gasSpendCaps: { en: 'Spend caps', ja: '支出上限' },
  gasNoSpendCapConfigured: {
    en: 'No spend cap configured.',
    ja: '支出上限が設定されていません。',
  },
  gasNoPerChainCaps: {
    en: 'No per-chain spend caps configured.',
    ja: 'チェーンごとの支出上限が設定されていません。',
  },
  gasLoadingPolicy: {
    en: 'Loading sponsorship policy...',
    ja: 'スポンサーポリシーを読み込んでいます…',
  },
  gasPolicyUnavailable: {
    en: 'This sponsorship policy is no longer available.',
    ja: 'このスポンサーポリシーは利用できなくなりました。',
  },
  gasClose: { en: 'Close', ja: '閉じる' },

  // Policy form
  gasEditPolicyTitle: { en: 'Edit sponsorship policy', ja: 'スポンサーポリシーを編集' },
  gasFormIntro: {
    en: 'Name the policy, choose its scope, then define either EVM call templates or NEAR delegate-action templates.',
    ja: 'ポリシーに名前を付けてスコープを選択し、EVM呼び出しテンプレートまたはNEARデリゲートアクションテンプレートを定義します。',
  },
  gasPolicyName: { en: 'Policy name', ja: 'ポリシー名' },
  gasPolicyNamePlaceholder: {
    en: 'Tempo testnet onboarding',
    ja: 'Tempoテストネットのオンボーディング',
  },
  gasRuleKind: { en: 'Rule kind', ja: 'ルールの種類' },
  gasRuleKindEvm: { en: 'EVM calls', ja: 'EVM呼び出し' },
  gasRuleKindNear: { en: 'NEAR delegate', ja: 'NEARデリゲート' },
  gasSpendCapPeriod: { en: 'Spend-cap period', ja: '支出上限の期間' },
  gasChain: { en: 'Chain', ja: 'チェーン' },
  gasNetwork: { en: 'Network', ja: 'ネットワーク' },
  gasNotAvailable: { en: 'N/A', ja: '対象外' },
  gasOn: { en: 'On', ja: 'オン' },
  gasOff: { en: 'Off', ja: 'オフ' },
  gasNoCap: { en: 'No cap', ja: '上限なし' },
  gasTurnOnChain: { en: 'Turn on chain', ja: 'チェーンをオンにしてください' },
  gasNearFollowsNetwork: {
    en: 'NEAR delegate sponsorship follows the selected environment network: {network}.',
    ja: 'NEARデリゲートのスポンサーは、選択した環境のネットワークに従います: {network}。',
  },
  gasDefineDelegate: {
    en: 'Define the allowlisted NEAR receivers, optional method lists, deposit bounds, and transfer allowance.',
    ja: '許可リストに入れるNEARレシーバー、任意のメソッド一覧、デポジットの上限、送金の可否を定義します。',
  },
  gasDefineContracts: {
    en: 'Define the allowlisted contract functions and their gas/value bounds for the selected chains.',
    ja: '選択したチェーンで許可リストに入れるコントラクト関数と、そのガス・値の上限を定義します。',
  },
  gasExecutionModeNear: {
    en: 'Execution mode: `near_delegate`.',
    ja: '実行モード: `near_delegate`',
  },
  gasExecutionModeEvm: {
    en: 'Execution mode: `evm_eoa`.',
    ja: '実行モード: `evm_eoa`',
  },
  gasAddDelegateHint: {
    en: 'Add one or more delegate actions to define the sponsored receiver and method templates.',
    ja: 'デリゲートアクションを1つ以上追加して、スポンサー対象のレシーバーとメソッドのテンプレートを定義します。',
  },
  gasAddContractHint: {
    en: 'Add one or more contracts to define the sponsored function templates.',
    ja: 'コントラクトを1つ以上追加して、スポンサー対象の関数テンプレートを定義します。',
  },
  gasAllowedDelegateAction: { en: 'Allowed delegate action', ja: '許可するデリゲートアクション' },
  gasRemove: { en: 'Remove', ja: '削除' },
  gasReceiverId: { en: 'Receiver ID', ja: 'レシーバーID' },
  gasMaxDepositYocto: { en: 'Max deposit (yoctoNEAR)', ja: '最大デポジット（yoctoNEAR）' },
  gasAllowedMethods: {
    en: 'Allowed methods (comma or newline separated)',
    ja: '許可するメソッド（カンマまたは改行区切り）',
  },
  gasAllowNativeTransfers: {
    en: 'Allow native transfers in the delegate action',
    ja: 'デリゲートアクションでネイティブ送金を許可する',
  },
  gasAddDelegateAction: { en: 'Add delegate action', ja: 'デリゲートアクションを追加' },
  gasAllowedContract: { en: 'Allowed contract', ja: '許可するコントラクト' },
  gasContractAddress: { en: 'Contract address', ja: 'コントラクトアドレス' },
  gasFunctionSignature: { en: 'Function signature', ja: '関数シグネチャ' },
  gasMaxGasLimit: { en: 'Max gas limit', ja: '最大ガスリミット' },
  gasMaxValueWei: { en: 'Max value (wei)', ja: '最大値（wei）' },
  gasAddFunction: { en: 'Add function', ja: '関数を追加' },
  gasAddContract: { en: 'Add contract', ja: 'コントラクトを追加' },
  gasDiscardDraft: { en: 'Discard draft', ja: '下書きを破棄' },
  gasSaving: { en: 'Saving...', ja: '保存中…' },
  gasSavePolicy: { en: 'Save sponsorship policy', ja: 'スポンサーポリシーを保存' },
  gasCreateSponsorshipPolicy: {
    en: 'Create sponsorship policy',
    ja: 'スポンサーポリシーを作成',
  },
  gasCancel: { en: 'Cancel', ja: 'キャンセル' },

  // Sponsored execution history
  gasChainFamilyNear: { en: 'NEAR delegate', ja: 'NEARデリゲート' },
  gasChainFamilyEvm: { en: 'EVM call', ja: 'EVM呼び出し' },
  gasReceiptBroadcastFailed: { en: 'Broadcast failed', ja: 'ブロードキャスト失敗' },
  gasReceiptRpcRejected: { en: 'RPC rejected', ja: 'RPCが拒否' },
  gasReceiptReverted: { en: 'Reverted', ja: 'リバート' },
  gasReceiptSucceeded: { en: 'Succeeded', ja: '成功' },
  gasNotCharged: { en: 'Not charged', ja: '課金なし' },
  gasNotChargedReason: { en: 'Not charged: {reason}', ja: '課金なし: {reason}' },
  gasLedgerRef: { en: 'Ledger {id}', ja: '台帳 {id}' },
  gasPricingRef: { en: 'Pricing {version}', ja: '料金 {version}' },
  gasReconMatched: { en: 'Matched', ja: '一致' },
  gasReconMissingDebit: { en: 'Missing debit', ja: '引き落とし欠落' },
  gasReconAmountMismatch: { en: 'Amount mismatch', ja: '金額の不一致' },
  gasReconUnexpectedDebit: { en: 'Unexpected debit', ja: '想定外の引き落とし' },
  gasExecutionItem: { en: 'execution', ja: '実行' },
  gasExecutionItemPlural: { en: 'executions', ja: '実行' },
  gasReconItem: { en: 'reconciliation row', ja: '照合レコード' },
  gasReconItemPlural: { en: 'reconciliation rows', ja: '照合レコード' },
  gasHistoryLabel: { en: 'Sponsored execution history', ja: 'スポンサー付き実行の履歴' },
  gasHistoryTitle: { en: 'Sponsored usage history', ja: 'スポンサー利用履歴' },
  gasHistoryDescription: {
    en: 'Last 90 days of sponsored executions with receipt outcomes and billed spend.',
    ja: '過去90日間のスポンサー付き実行について、レシートの結果と請求された支出を表示します。',
  },
  gasHistoryLoading: {
    en: 'Loading sponsored execution history...',
    ja: 'スポンサー付き実行の履歴を読み込んでいます…',
  },
  gasHistoryEmpty: {
    en: 'No sponsored executions found for this scope yet.',
    ja: 'このスコープのスポンサー付き実行はまだありません。',
  },
  gasWhenUtc: { en: 'When (UTC)', ja: '日時（UTC）' },
  gasCharge: { en: 'Charge', ja: '課金' },
  gasReceipt: { en: 'Receipt', ja: 'レシート' },
  gasReference: { en: 'Reference', ja: '参照' },
  gasCharged: { en: 'Charged', ja: '課金済み' },

  // Reconciliation
  gasReconLabel: {
    en: 'Sponsored execution reconciliation',
    ja: 'スポンサー付き実行の照合',
  },
  gasReconTitle: { en: 'Reconciliation', ja: '照合' },
  gasReconDescription: {
    en: 'Compare sponsored execution records against linked billing debits.',
    ja: 'スポンサー付き実行の記録を、関連付けられた請求の引き落としと照合します。',
  },
  gasReconMatchedHint: {
    en: 'Records aligned with billing',
    ja: '請求と一致した記録',
  },
  gasReconMismatches: { en: 'Mismatches', ja: '不一致' },
  gasReconMismatchesHint: {
    en: 'Missing, unexpected, or amount-mismatched debits',
    ja: '欠落、想定外、または金額が一致しない引き落とし',
  },
  gasReconNotChargedHint: {
    en: 'Execution records intentionally left unbilled',
    ja: '意図的に請求しなかった実行の記録',
  },
  gasReconRowsLabel: {
    en: 'Sponsored execution reconciliation rows',
    ja: 'スポンサー付き実行の照合行',
  },
  gasReconLoading: {
    en: 'Loading reconciliation data...',
    ja: '照合データを読み込んでいます…',
  },
  gasReconEmpty: {
    en: 'No reconciliation records found for this scope yet.',
    ja: 'このスコープの照合レコードはまだありません。',
  },
  gasSettledSpend: { en: 'Settled spend', ja: '確定した支出' },
  gasBillingDebit: { en: 'Billing debit', ja: '請求の引き落とし' },
  gasNotes: { en: 'Notes', ja: '備考' },
  gasChargedExecution: { en: 'Charged execution', ja: '課金された実行' },
  gasBillingDebitLinked: { en: 'Billing debit linked', ja: '請求の引き落としと関連付け済み' },
} as const satisfies Record<string, Entry>;
