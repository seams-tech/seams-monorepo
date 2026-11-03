import type { Entry } from '../entry';

/* Policy engine page. English is the source text. Statuses, ids, chain names and
   the raw action identifiers stay as the API sends them. */
export const policyEngineMessages = {
  // Page, filters, table
  policyPageLabel: { en: 'Policy engine page', ja: 'ポリシーエンジンのページ' },
  policyTableSectionLabel: { en: 'Policies table', ja: 'ポリシー表' },
  policyCreateWalletOverride: {
    en: 'Create wallet override',
    ja: 'ウォレットオーバーライドを作成',
  },
  policyCreatePolicy: { en: 'Create policy', ja: 'ポリシーを作成' },
  policyFiltersLabel: { en: 'Policy filters', ja: 'ポリシーのフィルター' },
  policySearchLabel: { en: 'Search policies', ja: 'ポリシーを検索' },
  policySearchPlaceholder: {
    en: 'Search policy name, ID, rules, or usage',
    ja: 'ポリシー名、ID、ルール、使用状況で検索',
  },
  policyFilterStatusLabel: {
    en: 'Filter policies by status',
    ja: 'ステータスでポリシーを絞り込み',
  },
  policyFilterStatusAll: { en: 'Status: All', ja: 'ステータス: すべて' },
  policyFilterStatusDraft: { en: 'Status: Draft', ja: 'ステータス: 下書き' },
  policyFilterStatusPublished: { en: 'Status: Published', ja: 'ステータス: 公開済み' },
  policyFilterImpactLabel: { en: 'Filter policies by impact', ja: '影響でポリシーを絞り込み' },
  policyFilterImpactAll: { en: 'Impact: All', ja: '影響: すべて' },
  policyFilterImpactUsed: { en: 'Impact: Used by wallets', ja: '影響: ウォレットで使用中' },
  policyFilterImpactUnused: { en: 'Impact: Unused', ja: '影響: 未使用' },
  policyUnassignedWalletsOne: {
    en: '{count} wallet unassigned in the current scope.',
    ja: '現在のスコープで割り当てのないウォレットが{count}件あります。',
  },
  policyUnassignedWalletsMany: {
    en: '{count} wallets unassigned in the current scope.',
    ja: '現在のスコープで割り当てのないウォレットが{count}件あります。',
  },
  policyRowsLabel: { en: 'Policies rows', ja: 'ポリシー行' },
  policyItemLabel: { en: 'policy', ja: 'ポリシー' },
  policyItemLabelPlural: { en: 'policies', ja: 'ポリシー' },
  policyColumnPolicy: { en: 'Policy', ja: 'ポリシー' },
  policyColumnCurrentScope: { en: 'Current scope', ja: '現在のスコープ' },
  policyColumnUsedBy: { en: 'Used by', ja: '使用元' },
  policyColumnUpdated: { en: 'Updated', ja: '更新日時' },
  policyColumnActions: { en: 'Actions', ja: '操作' },
  policyLoading: { en: 'Loading policies...', ja: 'ポリシーを読み込み中…' },
  policyUnavailable: {
    en: 'Policies unavailable: {message}',
    ja: 'ポリシーを利用できません: {message}',
  },
  policyEmptyFiltered: {
    en: 'No policies matched the current search and filters.',
    ja: '現在の検索とフィルターに一致するポリシーはありません。',
  },
  policyUnused: { en: 'Unused', ja: '未使用' },
  policyDetails: { en: 'Details', ja: '詳細' },
  policyMoreActionsFor: { en: 'More actions for {name}', ja: '{name}のその他の操作' },
  policyMenuEdit: { en: 'Edit', ja: '編集' },
  policyMenuSimulate: { en: 'Simulate', ja: 'シミュレート' },
  policyMenuGoLive: { en: 'Go live', ja: '公開' },
  policyMenuDelete: { en: 'Delete', ja: '削除' },
  policyDefaultCannotBeDeleted: {
    en: 'The organization default policy cannot be deleted.',
    ja: '組織のデフォルトポリシーは削除できません。',
  },

  // Counts
  policyWalletCountOne: { en: '{count} wallet', ja: '{count}ウォレット' },
  policyWalletCountMany: { en: '{count} wallets', ja: '{count}ウォレット' },
  policyListSeparator: { en: ', ', ja: '、' },

  // Policy status
  policyStatusPublished: { en: 'Published', ja: '公開済み' },
  policyStatusDraft: { en: 'Draft', ja: '下書き' },
  policyStatusArchived: { en: 'Archived', ja: 'アーカイブ済み' },
  policySystemDefault: { en: 'System default', ja: 'システムデフォルト' },

  // Action names (the API values are snake_case identifiers)
  policyActionTransfer: { en: 'Transfer', ja: '送金' },
  policyActionContractCall: { en: 'Contract call', ja: 'コントラクト呼び出し' },
  policyActionDeployContract: { en: 'Deploy contract', ja: 'コントラクトのデプロイ' },
  policyActionAddKey: { en: 'Add key', ja: '鍵の追加' },
  policyActionDeleteKey: { en: 'Delete key', ja: '鍵の削除' },
  policyActionSignMessage: { en: 'Sign message', ja: 'メッセージの署名' },
  policyActionExportKey: { en: 'Export key', ja: '鍵のエクスポート' },

  // Rule names and values
  policyRuleBlockedActions: { en: 'Blocked actions', ja: 'ブロックするアクション' },
  policyRuleAllowedChains: { en: 'Allowed chains', ja: '許可するチェーン' },
  policyRuleContractCalls: { en: 'Contract calls', ja: 'コントラクト呼び出し' },
  policyRuleMaxAmount: { en: 'Max amount', ja: '上限額' },
  policyNone: { en: 'None', ja: 'なし' },
  policyAllChains: { en: 'All chains', ja: 'すべてのチェーン' },
  policyNoLimit: { en: 'No limit', ja: '上限なし' },
  policyAllowAll: { en: 'Allow all', ja: 'すべて許可' },
  policyContractAllFunctions: {
    en: '{address} (all functions)',
    ja: '{address}（すべての関数）',
  },
  policyContractFunctions: {
    en: '{address} ({preview}{more})',
    ja: '{address}（{preview}{more}）',
  },
  policyContractFunctionsMore: { en: ' +{count} more', ja: ' 他{count}件' },
  policyRulesChains: { en: 'Chains: {list}', ja: 'チェーン: {list}' },
  policyRulesChainsAll: { en: 'Chains: all', ja: 'チェーン: すべて' },
  policyRulesBlocked: { en: 'Blocked: {list}', ja: 'ブロック: {list}' },
  policyRulesBlockedNone: { en: 'Blocked: none', ja: 'ブロック: なし' },
  policyRulesContractCallsOne: {
    en: 'Contract calls: {count} contract',
    ja: 'コントラクト呼び出し: {count}件のコントラクト',
  },
  policyRulesContractCallsMany: {
    en: 'Contract calls: {count} contracts',
    ja: 'コントラクト呼び出し: {count}件のコントラクト',
  },
  policyRulesContractCallsAll: {
    en: 'Contract calls: all',
    ja: 'コントラクト呼び出し: すべて',
  },
  policyRulesMaxAmount: { en: 'Max amount: {amount}', ja: '上限額: {amount}' },
  policyRulesMaxAmountNone: { en: 'Max amount: none', ja: '上限額: なし' },

  // Rule comparison
  policyColumnRule: { en: 'Rule', ja: 'ルール' },
  policyColumnLiveNow: { en: 'Live now', ja: '現在の公開内容' },
  policyBadgeChanged: { en: 'Changed', ja: '変更あり' },
  policyBadgeCurrent: { en: 'Current', ja: '変更なし' },
  policyLiveValue: { en: 'Live: {value}', ja: '公開中: {value}' },
  policyGoLive: { en: 'Go live', ja: '公開' },

  // Simulation summary
  policySimAnyChain: { en: 'any-chain', ja: '全チェーン' },
  policySimNoAmount: { en: 'no amount', ja: '指定なし' },
  policySimContract: { en: ' for contract {address}', ja: '、コントラクト: {address}' },
  policySimContractFunction: {
    en: ' for contract {address} function {selector}',
    ja: '、コントラクト: {address}、関数: {selector}',
  },
  policySimAllowed: {
    en: 'Allowed {action} on {chain} with amount {amount}{contract}.',
    ja: '{chain}での{action}を許可しました。金額: {amount}{contract}。',
  },
  policySimDenied: {
    en: 'Denied {action} on {chain} with amount {amount}{contract}. {reasons}',
    ja: '{chain}での{action}を拒否しました。金額: {amount}{contract}。{reasons}',
  },
  policySimDecision: {
    en: 'Decision {decision} on policy {policyId} v{version}. {summary}',
    ja: '判定 {decision}（ポリシー {policyId} v{version}）。{summary}',
  },

  // Coverage and scope
  policyCoverageNone: {
    en: 'Not currently covering wallets in this scope.',
    ja: 'このスコープでは現在どのウォレットにも適用されていません。',
  },
  policyCoverageSummary: {
    en: '{wallets}, total balance {balance}, last activity {time}',
    ja: '{wallets}、合計残高 {balance}、最終アクティビティ {time}',
  },
  policyScopeOrgDefault: { en: 'org default', ja: '組織のデフォルト' },
  policyScopeProjectDefault: { en: 'project default', ja: 'プロジェクトのデフォルト' },
  policyScopeEnvironmentOverride: { en: 'environment override', ja: '環境のオーバーライド' },
  policyScopeWalletOverride: {
    en: 'selected wallet override',
    ja: '選択したウォレットのオーバーライド',
  },
  policyScopeDraftOnly: { en: 'Draft only', ja: '下書きのみ' },

  // Draft comparison
  policyDraftAlreadyLive: {
    en: 'This policy is already live.',
    ja: 'このポリシーはすでに公開されています。',
  },
  policyDraftNotPublished: {
    en: 'This draft has not been published yet.',
    ja: 'この下書きはまだ公開されていません。',
  },
  policyDraftMatchesLive: {
    en: 'This draft matches the current live rules.',
    ja: 'この下書きは現在公開中のルールと一致しています。',
  },
  policyDraftChangesOne: {
    en: 'This draft changes {count} rule section from the live version.',
    ja: 'この下書きは公開バージョンから{count}件のルールセクションを変更します。',
  },
  policyDraftChangesMany: {
    en: 'This draft changes {count} rule sections from the live version.',
    ja: 'この下書きは公開バージョンから{count}件のルールセクションを変更します。',
  },

  // Validation, access and toasts
  policySessionUnavailable: {
    en: 'Console session is unavailable',
    ja: 'Consoleのセッションを利用できません',
  },
  policyAccessRequired: {
    en: 'Owner, administrator, or project editor access is required.',
    ja: 'オーナー、管理者、またはプロジェクト編集者の権限が必要です。',
  },
  policyMustBeNonNegativeInteger: {
    en: '{label} must be a non-negative integer.',
    ja: '{label}は0以上の整数で指定してください。',
  },
  policyMaxAmountPerTransaction: {
    en: 'Max amount per transaction',
    ja: '取引ごとの上限額',
  },
  policySimulationAmount: { en: 'Simulation amount', ja: 'シミュレーションの金額' },
  policyNameRequired: { en: 'Policy name is required.', ja: 'ポリシー名は必須です。' },
  policyWalletRequired: {
    en: 'Select or enter a wallet before creating a wallet override.',
    ja: 'ウォレットオーバーライドを作成する前に、ウォレットを選択または入力してください。',
  },
  policyAllowlistNeedsContract: {
    en: 'Add at least one contract before saving a contract-call allowlist.',
    ja: 'コントラクト呼び出しの許可リストを保存する前に、コントラクトを1つ以上追加してください。',
  },
  policySaved: {
    en: 'Saved policy {id} ({status}, v{version}).',
    ja: 'ポリシー {id} を保存しました（{status}、v{version}）。',
  },
  policyDeleted: { en: 'Deleted policy {id}.', ja: 'ポリシー {id} を削除しました。' },
  policySelectBeforeDelete: {
    en: 'Select a policy before deleting it.',
    ja: '削除するポリシーを選択してください。',
  },
  policySelectBeforePublish: {
    en: 'Select or save a policy before publishing.',
    ja: '公開する前に、ポリシーを選択または保存してください。',
  },
  policyPublished: { en: 'Published {id} (v{version}).', ja: '{id}（v{version}）を公開しました。' },
  policySelectBeforeApproval: {
    en: 'Select a saved policy before requesting approval.',
    ja: '承認をリクエストする前に、保存済みのポリシーを選択してください。',
  },
  policyApprovalReasonRequired: {
    en: 'Approval request reason is required.',
    ja: '承認リクエストの理由は必須です。',
  },
  policyApprovalCreated: {
    en: 'Created approval request {id} for {policyId}.',
    ja: '{policyId}の承認リクエスト {id} を作成しました。',
  },
  policyApprovalStatusChanged: {
    en: 'Approval request {id} is now {status}.',
    ja: '承認リクエスト {id} のステータスは {status} になりました。',
  },
  policySaveBeforeSimulation: {
    en: 'Save or select a policy before running simulation.',
    ja: 'シミュレーションを実行する前に、ポリシーを保存または選択してください。',
  },
  policyDraftRestored: { en: 'Restored unsaved draft.', ja: '未保存の下書きを復元しました。' },
  policyDiscardDraftConfirm: {
    en: 'Discard this unsaved draft?',
    ja: '未保存の下書きを破棄しますか？',
  },

  // Modal titles (aria-label)
  policyModalCreateLabel: { en: 'Create policy modal', ja: 'ポリシー作成モーダル' },
  policyModalDetailsLabel: { en: 'Policy details modal', ja: 'ポリシー詳細モーダル' },
  policyModalEditLabel: { en: 'Edit policy modal', ja: 'ポリシー編集モーダル' },
  policyModalDeleteLabel: { en: 'Delete policy modal', ja: 'ポリシー削除モーダル' },
  policyModalSimulateLabel: { en: 'Simulate policy modal', ja: 'ポリシーシミュレーションモーダル' },
  policyModalGoLiveLabel: {
    en: 'Schedule live policy change modal',
    ja: 'ポリシー公開モーダル',
  },

  // Create and edit
  policyEditTitle: { en: 'Edit policy', ja: 'ポリシーを編集' },
  policyIntroWalletOverride: {
    en: 'Create a wallet-specific draft for one wallet in the current dashboard context, then use Go live to publish it.',
    ja: '現在のダッシュボードのコンテキストで、1つのウォレット専用の下書きを作成し、「公開」で公開します。',
  },
  policyIntroStandard: {
    en: 'Create a draft for the current dashboard context, then use Go live to publish it.',
    ja: '現在のダッシュボードのコンテキストで下書きを作成し、「公開」で公開します。',
  },
  policyFieldName: { en: 'Policy name', ja: 'ポリシー名' },
  policyFieldMaxAmount: {
    en: 'Max amount per transaction (minor units)',
    ja: '取引ごとの上限額（最小単位）',
  },
  policyWalletOverrideTarget: {
    en: 'Wallet override target',
    ja: 'オーバーライド対象のウォレット',
  },
  policyWalletPreview: { en: 'Wallet preview', ja: 'ウォレットのプレビュー' },
  policyWalletsLoading: { en: 'Loading wallets...', ja: 'ウォレットを読み込み中…' },
  policyWalletFallback: { en: 'Wallet {id}', ja: 'ウォレット {id}' },
  policyWalletChoose: {
    en: 'Choose a wallet for the override target.',
    ja: 'オーバーライド対象のウォレットを選択してください。',
  },
  policyBlockedActionsHint: {
    en: 'Deny high-risk operations entirely.',
    ja: 'リスクの高い操作を完全に拒否します。',
  },
  policyAllowedChainsHint: {
    en: 'Limit the policy to specific networks.',
    ja: 'ポリシーを特定のネットワークに限定します。',
  },
  policyContractCallsHint: {
    en: 'Choose whether contract calls stay open, or restrict them to an allowlist of contracts and functions.',
    ja: 'コントラクト呼び出しを制限しないか、コントラクトと関数の許可リストに限定するかを選択します。',
  },
  policyAllowAllButton: { en: 'Allow All', ja: 'すべて許可' },
  policyAllowlistButton: { en: 'Allowlist', ja: '許可リスト' },
  policyAllowlistEmpty: {
    en: 'Add one or more contracts to define the contract-call allowlist.',
    ja: 'コントラクト呼び出しの許可リストを定義するには、コントラクトを1つ以上追加してください。',
  },
  policyAllowedContract: { en: 'Allowed contract', ja: '許可するコントラクト' },
  policyRemove: { en: 'Remove', ja: '削除' },
  policyContractAddress: { en: 'Contract address', ja: 'コントラクトアドレス' },
  policyAllowedFunctions: { en: 'Allowed functions', ja: '許可する関数' },
  policyFunction: { en: 'Function', ja: '関数' },
  policyFunctionPlaceholder: {
    en: 'transfer(address,uint256) or 0xa9059cbb',
    ja: 'transfer(address,uint256) または 0xa9059cbb',
  },
  policyAddFunction: { en: 'Add function', ja: '関数を追加' },
  policyAddContract: { en: 'Add contract', ja: 'コントラクトを追加' },
  policyContractCallsOpen: {
    en: 'Contract calls are allowed on any contract for the selected chains.',
    ja: '選択したチェーンでは、どのコントラクトへの呼び出しも許可されます。',
  },
  policyCancel: { en: 'Cancel', ja: 'キャンセル' },
  policySaving: { en: 'Saving...', ja: '保存中…' },
  policyCreateDraft: { en: 'Create draft', ja: '下書きを作成' },
  policySaveDraft: { en: 'Save draft', ja: '下書きを保存' },

  // Details modal
  policyDetailsTitle: { en: 'Policy details', ja: 'ポリシーの詳細' },
  policyDetailsIntro: {
    en: 'Review the current scope, live version, and rule behavior for this policy.',
    ja: 'このポリシーの現在のスコープ、公開バージョン、ルールの動作を確認します。',
  },
  policyDefaultLivePolicy: {
    en: 'Default live policy for this organization.',
    ja: 'この組織のデフォルトの公開ポリシーです。',
  },
  policyDetailPolicyId: { en: 'Policy ID', ja: 'ポリシーID' },
  policyDetailLiveVersion: { en: 'Live version', ja: '公開バージョン' },
  policyDetailCoverage: { en: 'Coverage', ja: '適用範囲' },
  policyDetailPublished: { en: 'Published', ja: '公開日時' },
  policyDetailsLoading: { en: 'Loading...', ja: '読み込み中…' },
  policyDetailsUnavailableValue: { en: 'Unavailable: {message}', ja: '利用できません: {message}' },
  policyVersionPublished: {
    en: 'v{version} published {time}',
    ja: 'v{version}（公開日時 {time}）',
  },
  policyNotLiveYet: { en: 'Not live yet', ja: '未公開' },
  policyRulesHeading: { en: 'Rules', ja: 'ルール' },
  policyRulesHint: {
    en: 'Current policy behavior by rule section.',
    ja: 'ルールセクションごとの現在のポリシーの動作です。',
  },
  policyChangeSummary: { en: 'Change summary', ja: '変更内容の概要' },
  policyClose: { en: 'Close', ja: '閉じる' },
  policyDetailsUnavailable: {
    en: 'Policy details are unavailable.',
    ja: 'ポリシーの詳細を利用できません。',
  },

  // Simulate modal
  policySimulateTitle: { en: 'Simulate policy', ja: 'ポリシーをシミュレート' },
  policySimulateIntro: {
    en: 'Test {name} before publishing it.',
    ja: '公開する前に{name}をテストします。',
  },
  policySimFieldAction: { en: 'Action', ja: 'アクション' },
  policySimFieldChain: { en: 'Chain', ja: 'チェーン' },
  policySimFieldAmount: { en: 'Amount (minor units)', ja: '金額（最小単位）' },
  policySimFieldSelector: { en: 'Function selector', ja: '関数セレクター' },
  policySimRun: { en: 'Run simulation', ja: 'シミュレーションを実行' },
  policySimRunning: { en: 'Simulating...', ja: 'シミュレーション中…' },
  policySimSelectPolicy: {
    en: 'Select a policy before simulating it.',
    ja: 'シミュレーションの前にポリシーを選択してください。',
  },

  // Delete modal
  policyDeleteTitle: { en: 'Delete policy', ja: 'ポリシーを削除' },
  policyDeleteMessage: {
    en: 'Delete {name} and remove it from the registry. This does not delete wallet activity history.',
    ja: '{name}を削除し、レジストリから取り除きます。ウォレットのアクティビティ履歴は削除されません。',
  },
  policyDeleteProtected: {
    en: 'The organization default policy is protected and cannot be deleted.',
    ja: '組織のデフォルトポリシーは保護されているため、削除できません。',
  },
  policyDeleting: { en: 'Deleting...', ja: '削除中…' },

  // Go live modal
  policyGoLiveTitle: { en: 'Go live review', ja: '公開前の確認' },
  policyGoLiveIntro: {
    en: 'Review what will change for this policy in the current dashboard context before requesting approvals or publishing it live.',
    ja: '承認をリクエストする前、または本番に公開する前に、現在のダッシュボードのコンテキストでこのポリシーに何が変わるかを確認します。',
  },
  policyReleaseContext: { en: 'Release context', ja: 'リリースのコンテキスト' },
  policyReleaseContextHint: {
    en: 'The policy, scope, and current live baseline for this publish.',
    ja: 'この公開の対象となるポリシー、スコープ、現在の公開内容の基準です。',
  },
  policyGoLiveContextLabel: { en: 'Go live review context', ja: '公開前の確認のコンテキスト' },
  policyLoadingComparison: {
    en: 'Loading live-rule comparison...',
    ja: '公開中のルールとの比較を読み込み中…',
  },
  policyComparisonUnavailable: {
    en: 'Live-rule comparison unavailable: {message}',
    ja: '公開中のルールとの比較を利用できません: {message}',
  },
  policyGoLiveChangesLabel: { en: 'Go live rule changes', ja: '公開時のルール変更' },
  policyNoRuleChanges: {
    en: 'This draft matches the current live rule set. Publishing again will not change the policy rules.',
    ja: 'この下書きは現在公開中のルールセットと一致しています。再度公開してもポリシーのルールは変わりません。',
  },
  policyInitialRuleSetLabel: { en: 'Initial live rule set', ja: '最初に公開するルールセット' },
  policyQueueApprovals: {
    en: 'Queue approvals here before the change is allowed to go live.',
    ja: '変更を公開する前に、ここで承認を依頼します。',
  },
  policyReviewRowPolicy: { en: 'Policy', ja: 'ポリシー' },
  policyReviewRowCurrentLive: { en: 'Current live version', ja: '現在の公開バージョン' },
  policyReviewRowNextLive: { en: 'Next live version', ja: '次の公開バージョン' },
  policyReviewRowScope: { en: 'Scope affected', ja: '影響を受けるスコープ' },
  policyReviewRowImpact: { en: 'Wallet impact', ja: 'ウォレットへの影響' },
  policyLoadingLiveVersion: {
    en: 'Loading current live version...',
    ja: '現在の公開バージョンを読み込み中…',
  },
  policyLoadingImpact: { en: 'Loading current impact...', ja: '現在の影響を読み込み中…' },
  policyNotAttached: {
    en: 'Not attached in the current org, project, and environment selection',
    ja: '現在選択中の組織、プロジェクト、環境には割り当てられていません',
  },
  policyWalletsUsing: {
    en: '{wallets} currently use this policy',
    ja: '{wallets}が現在このポリシーを使用しています',
  },
  policyUnusedInScope: { en: 'Unused in the current scope', ja: '現在のスコープでは未使用' },
  policyApprovalReasonField: {
    en: 'New approval request reason',
    ja: '新しい承認リクエストの理由',
  },
  policyApprovalDecisionField: { en: 'Approval decision reason', ja: '承認判断の理由' },
  policyApprovedRequestField: {
    en: 'Approved request for live publish',
    ja: '本番公開用の承認済みリクエスト',
  },
  policyNoApprovedRequest: {
    en: 'No approved request selected',
    ja: '承認済みリクエストが選択されていません',
  },
  policyCreatingRequest: { en: 'Creating request...', ja: 'リクエストを作成中…' },
  policyCreateApprovalRequest: { en: 'Create approval request', ja: '承認リクエストを作成' },
  policyPublishing: { en: 'Publishing...', ja: '公開中…' },
  policyPublishLive: { en: 'Publish live', ja: '本番に公開' },
  policyApprovalsLoading: {
    en: 'Loading live-change approvals...',
    ja: '公開変更の承認を読み込み中…',
  },
  policyApprovalsUnavailable: {
    en: 'Approvals unavailable: {message}',
    ja: '承認を利用できません: {message}',
  },
  policyApprovalsNone: {
    en: 'No approval requests are linked to this policy yet.',
    ja: 'このポリシーに関連付けられた承認リクエストはまだありません。',
  },
  policyApprovalItem: {
    en: '{id} {status} requested by {user} at {time}.',
    ja: '{id} {status}: {user}が{time}にリクエストしました。',
  },
  policyOpenedFromAudit: { en: 'Opened from audit.', ja: '監査ログから開きました。' },
  policyApprove: { en: 'Approve', ja: '承認' },
  policyApproving: { en: 'Approving...', ja: '承認中…' },
  policyReject: { en: 'Reject', ja: '却下' },
  policyRejecting: { en: 'Rejecting...', ja: '却下中…' },
  policySelectBeforeScheduling: {
    en: 'Select a policy before scheduling it live.',
    ja: '公開する前にポリシーを選択してください。',
  },
} as const satisfies Record<string, Entry>;
