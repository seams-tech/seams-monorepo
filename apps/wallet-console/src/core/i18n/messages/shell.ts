import type { Entry } from '../entry';

/* English is the source text; Japanese must keep each product name, plan name and
   price as written. Add a key here, then call t(key) from the component. */
export const shellMessages = {
  // Navigation groups
  navOverview: { en: 'Overview', ja: '概要' },
  navAdministration: { en: 'Administration', ja: '管理' },
  navWalletOperations: { en: 'Wallet operations', ja: 'ウォレット運用' },
  navPlatform: { en: 'Platform', ja: 'プラットフォーム' },
  navAccount: { en: 'Account', ja: 'アカウント' },
  navBilling: { en: 'Billing', ja: '請求' },
  navAdmin: { en: 'Admin', ja: '管理者' },

  // Navigation items
  navGasSponsorship: { en: 'Gas sponsorship', ja: 'ガス代スポンサー' },
  navUserWalletsList: { en: 'User wallets list', ja: 'ユーザーウォレット一覧' },
  navThresholdKeys: { en: 'Threshold Keys', ja: 'しきい値鍵' },
  navPolicyEngine: { en: 'Policy engine', ja: 'ポリシーエンジン' },
  navAuditLogs: { en: 'Audit logs', ja: '監査ログ' },
  navObservability: { en: 'Observability', ja: 'オブザーバビリティ' },
  navApiKeys: { en: 'API Keys', ja: 'APIキー' },
  navDeploymentStatus: { en: 'Deployment status', ja: 'デプロイ状況' },
  navWebhooks: { en: 'Webhooks', ja: 'Webhook' },
  navAccountSettings: { en: 'Account settings', ja: 'アカウント設定' },
  navTeamMembers: { en: 'Team members', ja: 'チームメンバー' },
  navBillingAccount: { en: 'Billing account', ja: '請求アカウント' },
  navPlan: { en: 'Plan', ja: 'プラン' },
  navInvoices: { en: 'Invoices', ja: '請求書' },
  navAdminSupport: { en: 'Admin support', ja: '管理サポート' },
  navOnboarding: { en: 'Onboarding', ja: 'オンボーディング' },
  navOnboardingWizard: { en: 'Onboarding wizard', ja: 'オンボーディングウィザード' },

  // Create actions
  createGasSponsorshipPolicy: {
    en: 'New gas sponsorship policy',
    ja: '新しいガス代スポンサーポリシー',
  },
  createPolicy: { en: 'New policy', ja: '新しいポリシー' },
  createWebhookEndpoint: { en: 'New webhook endpoint', ja: '新しいWebhookエンドポイント' },

  // Products
  productPlatformDescription: {
    en: 'Developer accounts and billing',
    ja: '開発者アカウントと請求',
  },

  // Webhook event categories
  webhookWalletLabel: { en: 'Wallet activity', ja: 'ウォレットのアクティビティ' },
  webhookWalletDescription: {
    en: 'Wallet provisioning, configuration, and state changes.',
    ja: 'ウォレットのプロビジョニング、設定、状態の変更。',
  },
  webhookPolicyLabel: { en: 'Policy changes', ja: 'ポリシーの変更' },
  webhookPolicyDescription: {
    en: 'Policy publish, assignment, and approval events.',
    ja: 'ポリシーの公開、割り当て、承認のイベント。',
  },
  webhookAuthLabel: { en: 'Authentication', ja: '認証' },
  webhookAuthDescription: {
    en: 'Authentication and identity lifecycle events.',
    ja: '認証とIDのライフサイクルに関するイベント。',
  },
  webhookTxLabel: { en: 'Transaction lifecycle', ja: 'トランザクションのライフサイクル' },
  webhookTxDescription: {
    en: 'Transaction creation, signing, submission, and status transitions.',
    ja: 'トランザクションの作成、署名、送信、ステータスの遷移。',
  },
  webhookBillingLabel: { en: 'Billing', ja: '請求' },
  webhookBillingDescription: {
    en: 'Invoices, usage, and payment lifecycle events.',
    ja: '請求書、使用量、支払いのライフサイクルに関するイベント。',
  },
  webhookSessionLabel: { en: 'Session lifecycle', ja: 'セッションのライフサイクル' },
  webhookSessionDescription: {
    en: 'Session creation, refresh, and teardown events.',
    ja: 'セッションの作成、更新、終了のイベント。',
  },

  // Account menu
  menuAccountSettings: { en: 'Account Settings', ja: 'アカウント設定' },
  menuSignOut: { en: 'Sign out', ja: 'サインアウト' },
  menuSigningOut: { en: 'Signing out...', ja: 'サインアウトしています…' },
  menuNetworkMainnet: { en: 'Network: Mainnet', ja: 'ネットワーク: メインネット' },
  menuNetworkTestnet: { en: 'Network: Testnet', ja: 'ネットワーク: テストネット' },
  menuSwitchToMainnet: { en: 'Switch to Mainnet', ja: 'メインネットに切り替え' },
  menuSwitchToTestnet: { en: 'Switch to Testnet', ja: 'テストネットに切り替え' },
  menuAccountFallback: { en: 'Account', ja: 'アカウント' },

  // Loading
  loadingOpeningPlatformConsole: {
    en: 'Opening Platform Console...',
    ja: 'Platform Consoleを開いています…',
  },
  loadingPrepareWorkspace: {
    en: 'Please wait while we prepare your workspace.',
    ja: 'ワークスペースを準備しています。しばらくお待ちください。',
  },

  // Sign-in page
  loginPlanFreeTitle: { en: 'Start on the Free plan', ja: 'Freeプランを始める' },
  loginPlanFreeDescription: {
    en: 'Sign in to create your account. The Free plan covers 300 active users.',
    ja: 'サインインしてアカウントを作成します。Freeプランはアクティブユーザー300人まで利用できます。',
  },
  loginPlanGrowthTitle: { en: 'Start Growth', ja: 'Growthを始める' },
  loginPlanGrowthDescription: {
    en: 'Growth is $99 a month from card confirmation, with 5,000 users included. We charge your card after each month.',
    ja: 'Growthはカード確認の時点から月額$99で、5,000ユーザーを含みます。料金は毎月の終了後にカードへ請求します。',
  },
  loginPlanProTitle: { en: 'Start Pro', ja: 'Proを始める' },
  loginPlanProDescription: {
    en: 'Pro is $399 a month from card confirmation, with 100,000 users included. We charge your card after each month.',
    ja: 'Proはカード確認の時点から月額$399で、100,000ユーザーを含みます。料金は毎月の終了後にカードへ請求します。',
  },
  loginGoogleCheckingSession: {
    en: 'Checking existing session...',
    ja: '既存のセッションを確認しています…',
  },
  loginGoogleSigningIn: { en: 'Signing in with Google...', ja: 'Googleでサインインしています…' },
  loginGoogleUnavailable: { en: 'Google SSO unavailable', ja: 'Google SSOは利用できません' },
  loginGoogleNotConfigured: {
    en: 'Google SSO not configured',
    ja: 'Google SSOが設定されていません',
  },
  loginGoogleContinue: { en: 'Continue with Google', ja: 'Googleで続行' },
  loginGithubSigningIn: { en: 'Signing in with GitHub...', ja: 'GitHubでサインインしています…' },
  loginGithubContinue: { en: 'Continue with GitHub', ja: 'GitHubで続行' },
  loginGithubUnavailable: {
    en: 'GitHub sign-in unavailable',
    ja: 'GitHubサインインは利用できません',
  },
  loginGithubPopupBlocked: {
    en: 'Allow pop-ups for this page to continue with GitHub.',
    ja: 'GitHubで続行するには、このページのポップアップを許可してください。',
  },
  loginGoogleNotVerified: {
    en: 'Google sign-in could not be verified. Try again.',
    ja: 'Googleサインインを確認できませんでした。もう一度お試しください。',
  },
  loginConfigureBoth: {
    en: 'Configure Google OIDC or GitHub OAuth on the relay to enable dashboard sign-in.',
    ja: 'ダッシュボードにサインインするには、リレーでGoogle OIDCまたはGitHub OAuthを設定してください。',
  },
  loginConfigureGithub: {
    en: 'Configure GitHub OAuth on the relay to enable GitHub sign-in.',
    ja: 'GitHubでサインインするには、リレーでGitHub OAuthを設定してください。',
  },
  loginConfigureGoogle: {
    en: 'Configure Google OIDC on the relay to enable Google sign-in.',
    ja: 'Googleでサインインするには、リレーでGoogle OIDCを設定してください。',
  },
  loginTitleGithubSignedIn: { en: 'Signed in with GitHub', ja: 'GitHubでサインインしました' },
  loginTitleSettingUp: { en: 'Setting up your account', ja: 'アカウントを設定しています' },
  loginTitleSignedOut: { en: 'Signed out', ja: 'サインアウトしました' },
  loginTitleWelcomeBack: { en: 'Welcome back', ja: 'おかえりなさい' },
  loginDescriptionCloseWindow: {
    en: 'You can close this window.',
    ja: 'このウィンドウは閉じて構いません。',
  },
  loginDescriptionOpeningGithub: { en: 'Opening GitHub...', ja: 'GitHubを開いています…' },
  loginDescriptionOpeningStripe: {
    en: 'Opening Stripe to add your card...',
    ja: 'カードを追加するためにStripeを開いています…',
  },
  loginDescriptionOpeningDashboard: {
    en: 'Opening your dashboard...',
    ja: 'ダッシュボードを開いています…',
  },
  loginDescriptionCreatingProject: {
    en: 'Creating your organization and first project...',
    ja: '組織と最初のプロジェクトを作成しています…',
  },
  loginDescriptionSignedOut: {
    en: 'You have been signed out of the Seams console.',
    ja: 'Seams Consoleからサインアウトしました。',
  },
  loginDescriptionSignIn: { en: 'Sign in to the Seams console', ja: 'Seams Consoleにサインイン' },
  loginAriaSignIn: { en: 'Sign in to Seams', ja: 'Seamsにサインイン' },
  loginAriaPage: { en: 'Dashboard login page', ja: 'ダッシュボードのログインページ' },
  loginAriaHome: { en: 'Seams home', ja: 'Seamsのホーム' },
  loginBrandLabel: { en: 'Console', ja: 'Console' },
  loginNoAccess: {
    en: 'Don’t have console access?',
    ja: 'コンソールへのアクセス権がありませんか？',
  },
  loginContactSales: { en: 'Contact sales', ja: '営業に相談' },
  loginAriaAbout: { en: 'About Seams', ja: 'Seamsについて' },
  loginDocumentation: { en: 'Documentation', ja: 'ドキュメント' },
  loginStatement: {
    en: 'Wallets for people and AI agents',
    ja: '人とAIエージェントのためのウォレット',
  },
  loginStatementSub: {
    en: 'Auth, wallets, credentials, and delegated access in one SDK. Policy checks every action before it runs.',
    ja: '認証、ウォレット、認証情報、委任アクセスを1つのSDKで提供します。ポリシーがすべての操作を実行前に検証します。',
  },
} as const satisfies Record<string, Entry>;
