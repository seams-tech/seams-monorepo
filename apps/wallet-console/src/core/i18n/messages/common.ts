import type { Entry } from '../entry';

/* Text shared by every page: auth helpers, tables, the sidebar and topbar, status
   labels and the dashboard shell's own error screens. */
export const commonMessages = {
  // Google and GitHub sign-in helpers
  commonGoogleNoCredential: {
    en: 'Google did not return a sign-in credential. Retry sign-in.',
    ja: 'Googleからサインイン資格情報が返されませんでした。もう一度サインインしてください。',
  },
  commonGoogleRetry: { en: 'Retry Google sign-in', ja: 'Googleサインインを再試行' },
  commonGoogleLoading: {
    en: 'Loading Google sign-in...',
    ja: 'Googleサインインを読み込んでいます…',
  },
  commonGoogleLoadFailed: {
    en: 'Could not load Google sign-in. Check your connection and retry.',
    ja: 'Googleサインインを読み込めませんでした。接続を確認して、もう一度お試しください。',
  },
  commonGoogleNoButtonApi: {
    en: 'Google sign-in loaded without its button API. Retry sign-in.',
    ja: 'Googleサインインのボタンを読み込めませんでした。もう一度サインインしてください。',
  },
  commonGoogleLoadTimeout: {
    en: 'Google sign-in took too long to load. Retry sign-in.',
    ja: 'Googleサインインの読み込みに時間がかかりすぎました。もう一度サインインしてください。',
  },
  commonGithubFailed: {
    en: 'GitHub sign-in failed: {error}',
    ja: 'GitHubサインインに失敗しました: {error}',
  },
  commonGithubStateMismatch: {
    en: 'GitHub sign-in state did not match. Please try again.',
    ja: 'GitHubサインインの状態が一致しませんでした。もう一度お試しください。',
  },
  commonSignedInWithGoogle: { en: 'Signed in with Google', ja: 'Googleでサインイン済み' },
  commonSignedInWithGithub: { en: 'Signed in with GitHub', ja: 'GitHubでサインイン済み' },

  // Copy button
  commonCopyToClipboard: { en: 'Copy to clipboard', ja: 'クリップボードにコピー' },

  // Tables and pagination
  commonTableSummary: {
    en: 'Showing {start}-{end} of {total} {item}',
    ja: '{total}件中 {start}〜{end}件を表示',
  },
  commonTableSummaryEmpty: { en: 'Showing 0 of 0 {item}', ja: '0件中 0件を表示' },
  commonTableLast: { en: 'Last', ja: '最後' },
  commonTablePrevious: { en: 'Previous', ja: '前へ' },
  commonTableNext: { en: 'Next', ja: '次へ' },
  commonTablePage: { en: 'Page {page} | {total}', ja: 'ページ {page} | {total}' },
  commonTableCurrentPage: {
    en: 'Current page {page} of {total}',
    ja: '現在のページ: {page} / {total}',
  },
  commonTableJumpTo: { en: 'Jump to', ja: '移動先' },
  commonTableJumpToPage: { en: 'Jump to page', ja: 'ページへ移動' },
  commonTableRows: { en: 'Rows', ja: '表示件数' },
  commonTableMoreActions: { en: 'More actions', ja: 'その他の操作' },

  // Scope picker
  commonScopeAdd: { en: 'Add scope', ja: 'スコープを追加' },
  commonScopeNoneSelected: { en: 'No scopes selected.', ja: 'スコープが選択されていません。' },
  commonScopeSelect: { en: 'Select a scope', ja: 'スコープを選択' },
  commonScopeAllSelected: {
    en: 'All available scopes selected',
    ja: '利用可能なスコープをすべて選択済み',
  },
  commonScopeToggles: { en: '{label} toggles', ja: '{label}の切り替え' },
  commonScopeDropdown: { en: '{label} dropdown', ja: '{label}のドロップダウン' },
  commonScopeSelectedList: { en: '{label} selected scopes', ja: '{label}の選択済みスコープ' },
  commonScopeRemove: { en: 'Remove scope {scope}', ja: 'スコープ {scope} を削除' },
  commonScopeOn: { en: 'On', ja: 'オン' },
  commonScopeOff: { en: 'Off', ja: 'オフ' },

  // URI list editor
  commonUriAdd: { en: 'Add URI', ja: 'URIを追加' },
  commonUriRowLabel: { en: 'URIs {number} *', ja: 'URI {number} *' },
  commonUriRowAria: { en: '{label} URI {number}', ja: '{label} URI {number}' },
  commonUriDelete: { en: 'Delete', ja: '削除' },
  commonUriDeleteAria: { en: 'Delete URI {number}', ja: 'URI {number}を削除' },

  // Workspace labels
  commonNoProject: { en: 'No project', ja: 'プロジェクトなし' },
  commonNoEnvironment: { en: 'No environment', ja: '環境なし' },
  commonEnvironmentDevelopment: { en: 'Development', ja: '開発' },
  commonEnvironmentStaging: { en: 'Staging', ja: 'ステージング' },
  commonEnvironmentProduction: { en: 'Production', ja: '本番' },

  // Sidebar
  commonSidebarSoon: { en: 'Soon', ja: '近日公開' },
  commonSidebarWorkspace: { en: 'Workspace', ja: 'ワークスペース' },
  commonSidebarProjects: { en: 'Projects', ja: 'プロジェクト' },
  commonSidebarNoEnvironments: { en: 'No environments', ja: '環境がありません' },
  commonSidebarNoProjects: { en: 'No projects yet', ja: 'プロジェクトはまだありません' },
  commonSidebarOrganizations: { en: 'Organizations', ja: '組織' },
  commonSidebarProducts: { en: 'Products', ja: 'プロダクト' },
  commonSidebarPrimaryNavigation: {
    en: 'Primary dashboard navigation',
    ja: 'ダッシュボードのメインナビゲーション',
  },
  commonSidebarCloseNavigation: { en: 'Close navigation', ja: 'ナビゲーションを閉じる' },
  commonSidebarCollapse: { en: 'Collapse sidebar', ja: 'サイドバーを折りたたむ' },
  commonSidebarProject: { en: 'Project', ja: 'プロジェクト' },
  commonSidebarNavigation: { en: 'Navigation', ja: 'ナビゲーション' },

  // Topbar
  commonNetworkTestnet: { en: 'Testnet', ja: 'テストネット' },
  commonNetworkMainnet: { en: 'Mainnet', ja: 'メインネット' },
  commonNetworkLabel: { en: 'Network', ja: 'ネットワーク' },
  commonTopbarSearchPages: { en: 'Search pages', ja: 'ページを検索' },
  commonTopbarSearchPagesPlaceholder: { en: 'Search pages...', ja: 'ページを検索…' },
  commonTopbarNoMatches: { en: 'No matching pages.', ja: '一致するページがありません。' },
  commonTopbarShortcuts: { en: 'Keyboard shortcuts', ja: 'キーボードショートカット' },
  commonTopbarNavigate: { en: 'Navigate', ja: '移動' },
  commonTopbarOpen: { en: 'Open', ja: '開く' },
  commonTopbarClose: { en: 'Close', ja: '閉じる' },
  commonTopbarDocs: { en: 'Docs', ja: 'ドキュメント' },
  commonTopbarAccountMenuFor: { en: 'Account menu for {name}', ja: '{name}のアカウントメニュー' },
  commonTopbarAccountOptions: { en: 'Account options', ja: 'アカウントオプション' },
  commonTopbarWorkspaceContext: { en: 'Workspace context', ja: 'ワークスペースのコンテキスト' },
  commonTopbarExpandSidebar: { en: 'Expand sidebar', ja: 'サイドバーを展開' },
  commonTopbarSearchEverything: { en: 'Search everything...', ja: 'すべてを検索…' },
  commonTopbarOpenNavigation: { en: 'Open navigation', ja: 'ナビゲーションを開く' },

  // Status labels
  commonStatusActive: { en: 'Active', ja: '有効' },
  commonStatusHealthy: { en: 'Healthy', ja: '正常' },
  commonStatusDelivered: { en: 'Delivered', ja: '配信済み' },
  commonStatusEnabled: { en: 'Enabled', ja: '有効' },
  commonStatusPublished: { en: 'Published', ja: '公開済み' },
  commonStatusResolved: { en: 'Resolved', ja: '解決済み' },
  commonStatusAccepted: { en: 'Accepted', ja: '承諾済み' },
  commonStatusCompleted: { en: 'Completed', ja: '完了' },
  commonStatusApproved: { en: 'Approved', ja: '承認済み' },
  commonStatusDegraded: { en: 'Degraded', ja: '低下' },
  commonStatusPaused: { en: 'Paused', ja: '一時停止' },
  commonStatusRetrying: { en: 'Retrying', ja: '再試行中' },
  commonStatusPending: { en: 'Pending', ja: '保留中' },
  commonStatusSuspended: { en: 'Suspended', ja: '停止中' },
  commonStatusDraft: { en: 'Draft', ja: '下書き' },
  commonStatusExpired: { en: 'Expired', ja: '期限切れ' },
  commonStatusWarn: { en: 'Warn', ja: '警告' },
  commonStatusUnknown: { en: 'Unknown', ja: '不明' },
  commonStatusFailing: { en: 'Failing', ja: '失敗が続いています' },
  commonStatusFailed: { en: 'Failed', ja: '失敗' },
  commonStatusRevoked: { en: 'Revoked', ja: '失効済み' },
  commonStatusFrozen: { en: 'Frozen', ja: '凍結' },
  commonStatusRemoved: { en: 'Removed', ja: '削除済み' },
  commonStatusArchived: { en: 'Archived', ja: 'アーカイブ済み' },
  commonStatusDeclined: { en: 'Declined', ja: '辞退済み' },
  commonStatusDisabled: { en: 'Disabled', ja: '無効' },
  commonStatusError: { en: 'Error', ja: 'エラー' },
  commonStatusFatal: { en: 'Fatal', ja: '致命的' },
  commonStatusDeadLetter: { en: 'Dead letter', ja: 'デッドレター' },
  commonStatusInfo: { en: 'Info', ja: '情報' },
  commonStatusSuccess: { en: 'Success', ja: '成功' },
  commonStatusSucceeded: { en: 'Succeeded', ja: '成功' },
  commonStatusOpen: { en: 'Open', ja: 'オープン' },
  commonStatusClosed: { en: 'Closed', ja: 'クローズ' },
  commonStatusInvited: { en: 'Invited', ja: '招待済み' },
  commonStatusInactive: { en: 'Inactive', ja: '無効' },
  commonStatusProcessing: { en: 'Processing', ja: '処理中' },
  commonStatusQueued: { en: 'Queued', ja: 'キュー待ち' },
  commonStatusRunning: { en: 'Running', ja: '実行中' },
  commonStatusRejected: { en: 'Rejected', ja: '却下' },
  commonStatusPaid: { en: 'Paid', ja: '支払い済み' },
  commonStatusUnpaid: { en: 'Unpaid', ja: '未払い' },
  commonStatusPastDue: { en: 'Past due', ja: '支払い期限超過' },
  commonStatusCanceled: { en: 'Canceled', ja: 'キャンセル済み' },
  commonStatusCancelled: { en: 'Cancelled', ja: 'キャンセル済み' },
  commonStatusTrialing: { en: 'Trialing', ja: 'トライアル中' },

  // Dashboard shell
  commonShellSwitchOrgFailed: {
    en: 'Unable to open the selected organization',
    ja: '選択した組織を開けません',
  },
  commonShellRecoverOrgFailed: {
    en: 'Organization context recovery failed',
    ja: '組織コンテキストの復旧に失敗しました',
  },
  commonShellSwitchOrgError: {
    en: 'Organization switch failed',
    ja: '組織の切り替えに失敗しました',
  },
  commonShellAccessAria: { en: 'Dashboard access', ja: 'ダッシュボードへのアクセス' },
  commonShellWorkspaceAria: { en: 'Dashboard workspace', ja: 'ダッシュボードのワークスペース' },
  commonShellNoWorkspaceTitle: {
    en: 'Unable to open your workspace',
    ja: 'ワークスペースを開けません',
  },
  commonShellNoWorkspaceBody: {
    en: 'Your current session does not have access to this organization.',
    ja: '現在のセッションには、この組織へのアクセス権がありません。',
  },
  commonShellSignInAgain: { en: 'Sign in again', ja: 'もう一度サインイン' },
  commonShellNoProjectTitle: {
    en: 'Unable to open this project',
    ja: 'このプロジェクトを開けません',
  },
  commonShellSelectionUnavailable: {
    en: 'The selected account or project is unavailable. Choose a project in Platform Console.',
    ja: '選択したアカウントまたはプロジェクトは利用できません。Platform Consoleでプロジェクトを選択してください。',
  },
  commonShellProjectsLoadFailed: {
    en: 'Projects could not be loaded. Try again.',
    ja: 'プロジェクトを読み込めませんでした。もう一度お試しください。',
  },
  commonShellOpenPlatformConsole: { en: 'Open Platform Console', ja: 'Platform Consoleを開く' },
  commonShellRetry: { en: 'Retry', ja: '再試行' },
  commonShellRedirectingToSignIn: {
    en: 'Redirecting to sign in...',
    ja: 'サインインへ移動しています…',
  },
  commonShellOpeningDashboard: { en: 'Opening dashboard...', ja: 'ダッシュボードを開いています…' },
  commonShellCheckingSession: {
    en: 'Checking your session...',
    ja: 'セッションを確認しています…',
  },
} as const satisfies Record<string, Entry>;
