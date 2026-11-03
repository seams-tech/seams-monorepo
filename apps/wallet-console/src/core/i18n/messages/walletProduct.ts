import type { Entry } from '../entry';

export const walletProductMessages = {
  // User wallets list: table
  walletListColWallet: { en: 'Wallet', ja: 'ウォレット' },
  walletListColOwner: { en: 'Owner', ja: '所有者' },
  walletListColPolicy: { en: 'Policy', ja: 'ポリシー' },
  walletListColBalance: { en: 'Balance', ja: '残高' },
  walletListColStatus: { en: 'Status', ja: 'ステータス' },
  walletListColUpdated: { en: 'Updated', ja: '更新日時' },
  walletListTableLabel: { en: 'Wallets table', ja: 'ウォレットテーブル' },
  walletListItemSingular: { en: 'wallet', ja: 'ウォレット' },
  walletListItemPlural: { en: 'wallets', ja: 'ウォレット' },

  // User wallets list: filters and sort
  walletListPageLabel: { en: 'User wallets list page', ja: 'ユーザーウォレット一覧ページ' },
  walletListSearchControls: { en: 'Wallet search controls', ja: 'ウォレット検索コントロール' },
  walletListSearchPlaceholder: {
    en: 'Search by wallet address, wallet ID, user ID, or external reference ID',
    ja: 'ウォレットアドレス、ウォレットID、ユーザーID、外部参照IDで検索',
  },
  walletListSearchLabel: { en: 'Search wallets', ja: 'ウォレットを検索' },
  walletListFilterPolicyLabel: {
    en: 'Filter wallets by policy',
    ja: 'ポリシーでウォレットを絞り込む',
  },
  walletListFilterTypeLabel: {
    en: 'Filter wallets by wallet type',
    ja: 'ウォレットタイプでウォレットを絞り込む',
  },
  walletListSortLabel: { en: 'Sort wallets', ja: 'ウォレットを並べ替え' },
  walletListPolicyOption: { en: 'Policy: {label}', ja: 'ポリシー: {label}' },
  walletListTypeOption: { en: 'Type: {label}', ja: 'タイプ: {label}' },
  walletListSortOption: { en: 'Sort: {label}', ja: '並べ替え: {label}' },
  walletListAnyPolicy: { en: 'Any policy', ja: 'すべてのポリシー' },
  walletListTypeAll: { en: 'EOA + Smart', ja: 'EOA + スマート' },
  walletListTypeEoa: { en: 'EOA only', ja: 'EOAのみ' },
  walletListTypeSmart: { en: 'Smart only', ja: 'スマートのみ' },
  walletListSortNewest: { en: 'Newest first', ja: '新しい順' },
  walletListSortOldest: { en: 'Oldest first', ja: '古い順' },
  walletListSortHighestBalance: { en: 'Highest balance', ja: '残高が多い順' },
  walletListSortLowestBalance: { en: 'Lowest balance', ja: '残高が少ない順' },
  walletListSortRecentActivity: { en: 'Recent activity', ja: '最近のアクティビティ順' },
  walletListSortOldestActivity: { en: 'Oldest activity', ja: 'アクティビティが古い順' },

  // User wallets list: summary
  walletListSummaryLabel: { en: 'Wallet summary metrics', ja: 'ウォレットの概要指標' },
  walletListSummaryWallets: { en: 'Wallets', ja: 'ウォレット' },
  walletListSummaryFunded: { en: 'Funded', ja: '入金済み' },
  walletListSummaryActive: { en: 'Active', ja: 'アクティブ' },

  // User wallets list: states
  walletListSessionUnavailable: {
    en: 'Console session is unavailable',
    ja: 'Consoleセッションを利用できません',
  },
  walletListSearching: { en: 'Searching wallets...', ja: 'ウォレットを検索しています…' },
  walletListLoading: {
    en: 'Loading wallets from console API...',
    ja: 'Console APIからウォレットを読み込んでいます…',
  },
  walletListSearchFailed: { en: 'Search failed: {message}', ja: '検索に失敗しました: {message}' },
  walletListUnavailable: {
    en: 'Wallet list unavailable: {message}',
    ja: 'ウォレット一覧を利用できません: {message}',
  },
  walletListNoMatch: {
    en: 'No wallets matched this query.',
    ja: '検索条件に一致するウォレットはありません。',
  },
  walletListEmpty: {
    en: 'No wallets in this environment yet. Wallets appear here after your first user signs up.',
    ja: 'この環境にはまだウォレットがありません。最初のユーザーがサインアップすると、ここにウォレットが表示されます。',
  },
  walletListToggleBalances: {
    en: 'Toggle chain balances for {address}',
    ja: '{address}のチェーン別残高を切り替える',
  },

  // User wallets list: footer
  walletListFooterResultsOne: {
    en: 'Showing {count} result.',
    ja: '{count}件の結果を表示しています。',
  },
  walletListFooterResultsMany: {
    en: 'Showing {count} results.',
    ja: '{count}件の結果を表示しています。',
  },
  walletListFooterWalletsOne: { en: '{count} wallet.', ja: 'ウォレット{count}件。' },
  walletListFooterWalletsMany: { en: '{count} wallets.', ja: 'ウォレット{count}件。' },
  walletListFooterScopeProject: {
    en: 'Scope: project {project}.',
    ja: 'スコープ: プロジェクト {project}。',
  },
  walletListFooterScopeEnvironment: {
    en: 'Scope: project {project}, environment {environment}.',
    ja: 'スコープ: プロジェクト {project}、環境 {environment}。',
  },

  // User wallets list: chain balances panel
  walletBalancesLabel: { en: 'Gas balances for {address}', ja: '{address}のガス残高' },
  walletBalancesTitle: { en: 'Gas balances', ja: 'ガス残高' },
  walletBalancesUpdated: { en: 'Updated {time}', ja: '更新: {time}' },
  walletBalancesWaiting: {
    en: 'Waiting for first balance refresh',
    ja: '最初の残高更新を待機しています',
  },
  walletBalancesGasCurrency: { en: 'Gas currency', ja: 'ガス通貨' },
  walletBalancesAccount: { en: 'Account', ja: 'アカウント' },
  walletBalancesAddress: { en: 'Address', ja: 'アドレス' },
  walletBalancesEmpty: {
    en: 'Balances have not been read yet.',
    ja: '残高はまだ読み取られていません。',
  },

  // Deployment status: live access
  walletDeployAccessRefreshFailed: {
    en: 'Wallet access could not be refreshed. Check the project service status.',
    ja: 'ウォレットへのアクセスを更新できませんでした。プロジェクトのサービスステータスを確認してください。',
  },
  walletDeployAccessPreparing: {
    en: 'Wallet access is still being prepared. Retry to check its progress.',
    ja: 'ウォレットへのアクセスはまだ準備中です。再試行して進行状況を確認してください。',
  },
  walletDeployOnlyActiveService: {
    en: 'Only an active Wallet service can refresh live access.',
    ja: 'ライブアクセスを更新できるのは、有効なウォレットサービスのみです。',
  },
  walletDeployProductionUnavailable: {
    en: 'The production environment is unavailable. Check the project service status.',
    ja: '本番環境を利用できません。プロジェクトのサービスステータスを確認してください。',
  },
  walletDeployNeedsCredit: {
    en: 'Live Wallet access requires prepaid credit. Add credits, then refresh access.',
    ja: 'ライブのウォレットアクセスにはプリペイドクレジットが必要です。クレジットを追加してから、アクセスを更新してください。',
  },
  walletDeployLiveRefreshFailed: {
    en: 'Live Wallet access could not be refreshed.',
    ja: 'ライブのウォレットアクセスを更新できませんでした。',
  },
  walletDeployLiveTitle: { en: 'Live Wallet access', ja: 'ライブのウォレットアクセス' },
  walletDeployLiveDescription: {
    en: 'After you add prepaid credits, refresh access to enable production for this project.',
    ja: 'プリペイドクレジットを追加したら、アクセスを更新して、このプロジェクトの本番環境を有効にしてください。',
  },
  walletDeployLiveRefreshing: { en: 'Refreshing live access…', ja: 'ライブアクセスを更新中…' },
  walletDeployLiveRefresh: {
    en: 'Refresh live Wallet access',
    ja: 'ライブのウォレットアクセスを更新',
  },
  walletDeployLiveEnabled: {
    en: 'Live Wallet access is enabled.',
    ja: 'ライブのウォレットアクセスは有効です。',
  },

  // Deployment status: page
  walletDeployProjectionUnavailable: {
    en: 'The active deployment projection is unavailable.',
    ja: 'アクティブなデプロイのプロジェクションを利用できません。',
  },
  walletDeployProjectionInvalid: {
    en: 'The active deployment projection is invalid.',
    ja: 'アクティブなデプロイのプロジェクションが無効です。',
  },
  walletDeployStatusUnavailable: {
    en: 'Deployment status is unavailable.',
    ja: 'デプロイ状況を利用できません。',
  },
  walletDeployUnavailableValue: { en: 'Unavailable', ja: '利用できません' },
  walletDeployLoadingEvidence: {
    en: 'Loading deployment evidence…',
    ja: 'デプロイの証跡を読み込み中…',
  },
  walletDeployUnavailableTitle: { en: 'Deployment unavailable', ja: 'デプロイを利用できません' },
  walletDeployUnavailableGateway: {
    en: 'The gateway cannot serve a verified deployment.',
    ja: 'ゲートウェイは検証済みのデプロイを提供できません。',
  },
  walletDeploySelectedEnvironment: { en: 'Selected environment:', ja: '選択中の環境:' },
  walletDeployUnavailableAsk: {
    en: 'Ask an operator to check activation, deployment data, and gateway configuration.',
    ja: '運用担当者に、有効化、デプロイデータ、ゲートウェイ設定の確認を依頼してください。',
  },
  walletDeployMismatchTitle: {
    en: 'Gateway environment mismatch',
    ja: 'ゲートウェイの環境が一致しません',
  },
  walletDeployMismatchBody: {
    en: 'This gateway serves a different environment. Ask an operator to check the deployment assignment.',
    ja: 'このゲートウェイは別の環境を提供しています。運用担当者にデプロイの割り当ての確認を依頼してください。',
  },
  walletDeployActiveEnvironment: { en: 'Active environment:', ja: 'アクティブな環境:' },
  walletDeployTitle: { en: 'Deployment status', ja: 'デプロイ状況' },
  walletDeployOwnersOnly: {
    en: 'Only organization owners can view deployment status and audit evidence.',
    ja: 'デプロイ状況と監査の証跡を表示できるのは、組織のオーナーのみです。',
  },
  walletDeployOwnerView: { en: 'Owner view', ja: 'オーナー向け表示' },
  walletDeployReadOnly: {
    en: 'Read-only evidence for {project} · {environment}. Cutovers run from the protected repository workflow.',
    ja: '{project} · {environment} の読み取り専用の証跡です。切り替えは、保護されたリポジトリのワークフローから実行されます。',
  },
  walletDeployRefresh: { en: 'Refresh deployment status', ja: 'デプロイ状況を更新' },
  walletDeployActiveVerified: { en: 'Active and verified', ja: '有効・検証済み' },
  walletDeployBindingTitle: { en: 'Immutable binding', ja: '不変のバインディング' },
  walletDeployBindingDescription: {
    en: 'The active tenant identity, origins, and canary receipt are audit-only here.',
    ja: 'アクティブなテナントのID、オリジン、カナリアレシートは、ここでは監査専用です。',
  },
  walletDeployEnvironmentId: { en: 'Environment ID', ja: '環境ID' },
  walletDeployMode: { en: 'Mode', ja: 'モード' },
  walletDeployApplicationOrigin: { en: 'Application origin', ja: 'アプリケーションのオリジン' },
  walletDeployHostedWalletOrigin: {
    en: 'Hosted wallet origin',
    ja: 'ホスト型ウォレットのオリジン',
  },
  walletDeployGatewayOrigin: { en: 'Gateway origin', ja: 'ゲートウェイのオリジン' },
  walletDeployRelyingParty: { en: 'Passkey relying party', ja: 'パスキーのリライングパーティ' },
  walletDeployActivation: { en: 'Activation', ja: '有効化' },
  walletDeployCanaryDigest: { en: 'Canary receipt digest', ja: 'カナリアレシートのダイジェスト' },

  // Wallet service gate
  walletGateStorageFailed: {
    en: 'This browser could not save Wallet setup progress. Allow site storage and retry.',
    ja: 'このブラウザーはウォレットのセットアップ進行状況を保存できませんでした。サイトのストレージを許可して、再試行してください。',
  },
  walletGateSlow: {
    en: 'Wallet setup is taking longer than expected. Retry to check its progress.',
    ja: 'ウォレットのセットアップに想定より時間がかかっています。再試行して進行状況を確認してください。',
  },
  walletGateIncomplete: {
    en: 'Wallet setup could not be completed.',
    ja: 'ウォレットのセットアップを完了できませんでした。',
  },
  walletGateAbsent: {
    en: 'An organization owner or administrator with project management access must open this project to finish Wallet setup.',
    ja: 'ウォレットのセットアップを完了するには、プロジェクト管理権限を持つ組織のオーナーまたは管理者が、このプロジェクトを開く必要があります。',
  },
  walletGateDisabled: {
    en: 'Wallet access is disabled for this project. Contact your organization administrator.',
    ja: 'このプロジェクトではウォレットへのアクセスが無効になっています。組織の管理者に連絡してください。',
  },
  walletGateFailed: {
    en: 'Wallet setup failed. Retry to check its progress.',
    ja: 'ウォレットのセットアップに失敗しました。再試行して進行状況を確認してください。',
  },
  walletGateArchived: {
    en: 'This Wallet instance is archived. Select another project to continue.',
    ja: 'このウォレットインスタンスはアーカイブされています。続行するには、別のプロジェクトを選択してください。',
  },
  walletGateSelectEnvironment: {
    en: 'Select a Wallet environment to continue.',
    ja: '続行するには、ウォレットの環境を選択してください。',
  },
  walletGateInProgress: {
    en: 'Wallet setup is in progress.',
    ja: 'ウォレットのセットアップを実行中です。',
  },
  walletGatePreparing: { en: 'Preparing Wallet...', ja: 'ウォレットを準備しています…' },
  walletGateSetupUnavailable: {
    en: 'Wallet setup unavailable',
    ja: 'ウォレットのセットアップを利用できません',
  },
  walletGateRetry: { en: 'Retry setup', ja: 'セットアップを再試行' },
  walletGateLoadingEnvironments: {
    en: 'Loading Wallet environments...',
    ja: 'ウォレットの環境を読み込んでいます…',
  },
  walletGateUnavailable: { en: 'Wallet unavailable', ja: 'ウォレットを利用できません' },
  walletGateCheckAgain: { en: 'Check again', ja: '再確認' },
  walletGateLoadingProject: { en: 'Loading project...', ja: 'プロジェクトを読み込んでいます…' },
} as const satisfies Record<string, Entry>;
