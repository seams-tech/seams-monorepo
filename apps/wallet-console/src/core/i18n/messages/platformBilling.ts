import type { Entry } from '../entry';

/* Platform billing (admin account lookup, credit and refund dialogs) and the Free plan
   notices and plan page. English is the source text. Plan names, prices and limits keep
   the numbers of the sign-in page and the pricing page. */
export const platformBillingMessages = {
  // Ledger event types
  platformBillingEventAll: { en: 'All events', ja: 'すべてのイベント' },
  platformBillingCreditPurchases: { en: 'Credit purchases', ja: 'クレジット購入' },
  platformBillingEventUsageDebit: { en: 'Usage debits', ja: '使用量の引き落とし' },
  platformBillingEventSponsoredDebit: {
    en: 'Sponsored execution debits',
    ja: 'スポンサー実行の引き落とし',
  },
  platformBillingEventManual: { en: 'Manual adjustments', ja: '手動調整' },
  platformBillingRefunds: { en: 'Refunds', ja: '返金' },
  platformBillingEventDisputeOpened: { en: 'Disputes opened', ja: '不審請求の申請' },
  platformBillingEventDisputeWon: { en: 'Disputes won', ja: '不審請求での勝訴' },

  // Owners and projects
  platformBillingNoOwner: { en: 'no active owner', ja: 'アクティブなオーナーなし' },
  platformBillingOwnerOne: { en: 'owner {email}', ja: 'オーナー {email}' },
  platformBillingOwnerMany: { en: 'owners {email} +{more}', ja: 'オーナー {email} 他{more}人' },
  platformBillingProjectOne: { en: 'project {names}', ja: 'プロジェクト: {names}' },
  platformBillingProjectMany: { en: 'projects {names}', ja: 'プロジェクト: {names}' },
  platformBillingNoProjects: { en: 'no projects', ja: 'プロジェクトなし' },

  // Live access states
  platformBillingBlocked: { en: 'Blocked', ja: 'ブロック中' },
  platformBillingLow: { en: 'Low', ja: '残高少' },
  platformBillingEnabled: { en: 'Enabled', ja: '有効' },
  platformBillingAllowedLow: { en: 'Allowed, low balance', ja: '許可（残高少）' },
  platformBillingAllowed: { en: 'Allowed', ja: '許可' },

  // Activity table
  platformBillingItemEvent: { en: 'event', ja: 'イベント' },
  platformBillingItemEvents: { en: 'events', ja: 'イベント' },
  platformBillingActivityAria: { en: 'Account activity', ja: 'アカウントのアクティビティ' },
  platformBillingNoLedgerEvents: {
    en: 'No ledger events match the filters.',
    ja: '条件に一致する台帳イベントはありません。',
  },
  platformBillingColWhen: { en: 'When (UTC)', ja: '日時（UTC）' },
  platformBillingColEvent: { en: 'Event', ja: 'イベント' },
  platformBillingColAmount: { en: 'Amount', ja: '金額' },
  platformBillingColReason: { en: 'Reason', ja: '理由' },
  platformBillingColAction: { en: 'Action', ja: '操作' },
  platformBillingReverses: { en: 'Reverses {id}', ja: '{id}を取り消し' },
  platformBillingBy: { en: 'by {actor}', ja: '実行者: {actor}' },
  platformBillingReversed: { en: 'Reversed', ja: '取り消し済み' },
  platformBillingReverse: { en: 'Reverse', ja: '取り消し' },

  // Payments and refunds tables
  platformBillingLoadingPurchases: { en: 'Loading purchases', ja: '購入を読み込んでいます' },
  platformBillingNoStripePurchases: {
    en: 'This account has no Stripe purchases.',
    ja: 'このアカウントにはStripeでの購入がありません。',
  },
  platformBillingColPurchase: { en: 'Purchase', ja: '購入' },
  platformBillingColPaid: { en: 'Paid', ja: '支払い額' },
  platformBillingColRefunded: { en: 'Refunded', ja: '返金額' },
  platformBillingRefund: { en: 'Refund', ja: '返金' },
  platformBillingNoRefunds: {
    en: 'No refunds have been requested.',
    ja: '返金のリクエストはありません。',
  },
  platformBillingColStatus: { en: 'Status', ja: 'ステータス' },
  platformBillingChecking: { en: 'Checking...', ja: '確認しています…' },
  platformBillingCheckStatus: { en: 'Check status', ja: 'ステータスを確認' },
  platformBillingRefundStatusRequested: { en: 'requested', ja: 'リクエスト済み' },
  platformBillingRefundStatusProviderPending: { en: 'provider pending', ja: 'プロバイダー処理中' },
  platformBillingRefundStatusSucceeded: { en: 'succeeded', ja: '成功' },
  platformBillingRefundStatusFailed: { en: 'failed', ja: '失敗' },
  platformBillingRefundStatusCanceled: { en: 'canceled', ja: 'キャンセル済み' },

  // Toasts
  platformBillingToastAlreadyReversed: {
    en: 'That entry was already reversed. {name} has {balance}.',
    ja: 'このエントリはすでに取り消されています。{name}の残高は{balance}です。',
  },
  platformBillingToastAlreadyHeld: {
    en: 'The ledger already holds this adjustment. {name} has {balance}.',
    ja: 'この調整はすでに台帳に記録されています。{name}の残高は{balance}です。',
  },
  platformBillingToastCreditAdded: {
    en: 'Added {amount} credit to {name}. The balance is {balance}.',
    ja: '{name}に{amount}のクレジットを追加しました。残高は{balance}です。',
  },
  platformBillingToastDebited: {
    en: 'Debited {amount} from {name}. The balance is {balance}.',
    ja: '{name}から{amount}を引き落としました。残高は{balance}です。',
  },
  platformBillingToastRefundCreated: {
    en: 'Refund {id} is {status}. The balance is {balance}.',
    ja: '返金{id}のステータス: {status}。残高は{balance}です。',
  },
  platformBillingToastRefundStatus: {
    en: 'Refund {id} is {status}.',
    ja: '返金{id}のステータス: {status}。',
  },

  // Filters and search
  platformBillingFiltersAria: { en: 'Activity filters', ja: 'アクティビティのフィルター' },
  platformBillingPeriod: { en: 'Period', ja: '期間' },
  platformBillingEventType: { en: 'Event type', ja: 'イベントの種類' },
  platformBillingApplying: { en: 'Applying...', ja: '適用しています…' },
  platformBillingApplyFilters: { en: 'Apply filters', ja: 'フィルターを適用' },
  platformBillingReset: { en: 'Reset', ja: 'リセット' },
  platformBillingFindAccount: { en: 'Find an account', ja: 'アカウントを検索' },
  platformBillingSearchPlaceholder: {
    en: 'Organization name, org_123 or member email',
    ja: '組織名、org_123、またはメンバーのメールアドレス',
  },
  platformBillingMatchingAccounts: { en: 'Matching accounts', ja: '一致するアカウント' },
  platformBillingSearching: { en: 'Searching...', ja: '検索しています…' },
  platformBillingSearchFailed: {
    en: 'The search failed. Change the text and try again.',
    ja: '検索に失敗しました。テキストを変更してもう一度お試しください。',
  },
  platformBillingNoOrganizations: {
    en: 'No organizations exist yet.',
    ja: 'まだ組織がありません。',
  },
  platformBillingNoMatchBefore: { en: 'No account matches ', ja: '' },
  platformBillingNoMatchAfter: { en: '.', ja: 'に一致するアカウントはありません。' },
  platformBillingNewestOrganizations: { en: 'Newest organizations', ja: '新しい組織' },

  // Account card
  platformBillingAccountAria: { en: 'Account', ja: 'アカウント' },
  platformBillingAddCredit: { en: 'Add credit', ja: 'クレジットを追加' },
  platformBillingMoreActions: { en: 'More account actions', ja: 'アカウントのその他の操作' },
  platformBillingDebitBalance: { en: 'Debit balance', ja: '残高から引き落とし' },
  platformBillingBalance: { en: 'Balance', ja: '残高' },
  platformBillingAvailableHeld: {
    en: '{available} available; {held} is held',
    ja: '利用可能: {available}、保留中: {held}',
  },
  platformBillingLowBalanceWarning: {
    en: 'Low-balance warning at {threshold}',
    ja: '残高が{threshold}以下で警告',
  },
  platformBillingLiveEnvironments: { en: 'Live environments', ja: 'ライブ環境' },
  platformBillingNeedsBalance: {
    en: 'Needs a balance above $0',
    ja: '残高が$0を超えている必要があります',
  },
  platformBillingCanCreateEnvironments: {
    en: 'Projects can create staging and production environments',
    ja: 'プロジェクトでステージング環境と本番環境を作成できます',
  },
  platformBillingThisMonth: { en: 'This month', ja: '今月' },
  platformBillingActiveWallets: {
    en: '{count} active wallets',
    ja: 'アクティブなウォレット{count}件',
  },
  platformBillingUsedBought: {
    en: '{used} used · {bought} bought',
    ja: '使用 {used} · 購入 {bought}',
  },
  platformBillingRecordsAria: { en: 'Account records', ja: 'アカウントの記録' },
  platformBillingTabActivity: { en: 'Activity', ja: 'アクティビティ' },
  platformBillingTabPayments: { en: 'Payments and refunds', ja: '支払いと返金' },

  // Adjustment dialog
  platformBillingReasonCorrection: {
    en: 'Correction of a mistaken entry',
    ja: '誤ったエントリの訂正',
  },
  platformBillingReasonPlatformOwner: {
    en: 'Platform owner account',
    ja: 'プラットフォームオーナーのアカウント',
  },
  platformBillingReasonIncident: { en: 'Incident credit', ja: '障害に対するクレジット' },
  platformBillingReasonGoodwill: { en: 'Goodwill', ja: 'お詫び' },
  platformBillingReasonUnbilled: { en: 'Usage that was not billed', ja: '未請求の使用量' },
  platformBillingReasonClosure: { en: 'Account closure', ja: 'アカウントの閉鎖' },
  platformBillingAddingCredit: {
    en: 'Adding credit...',
    ja: 'クレジットを追加しています…',
  },
  platformBillingDebiting: { en: 'Debiting...', ja: '引き落としています…' },
  platformBillingAddAmountCredit: { en: 'Add {amount} credit', ja: '{amount}のクレジットを追加' },
  platformBillingDebitAmount: { en: 'Debit {amount}', ja: '{amount}を引き落とし' },
  platformBillingDebit: { en: 'Debit', ja: '引き落とし' },
  platformBillingReverseAdminDebit: {
    en: 'Reverse admin debit',
    ja: '管理者による引き落としを取り消し',
  },
  platformBillingReverseSupportCredit: {
    en: 'Reverse support credit',
    ja: 'サポートクレジットを取り消し',
  },
  platformBillingDebitOrganization: { en: 'Debit {name}', ja: '{name}から引き落とし' },
  platformBillingRemovesCredit: {
    en: 'Removes credit from the balance.',
    ja: '残高からクレジットを差し引きます。',
  },
  platformBillingAmountUsd: { en: 'Amount (USD)', ja: '金額（USD）' },
  platformBillingAmountAria: { en: 'Amount in US dollars', ja: '米ドルでの金額' },
  platformBillingOtherAmount: { en: 'Other amount', ja: 'その他の金額' },
  platformBillingAmountInvalid: {
    en: 'Enter an amount above $0, such as 25.00.',
    ja: '$0を超える金額を入力してください（例: 25.00）。',
  },
  platformBillingReversalAmountBefore: { en: 'A reversal uses the amount of ', ja: '' },
  platformBillingReversalAmountAfter: { en: '.', ja: 'の金額で取り消します。' },
  platformBillingChooseReason: { en: 'Choose a reason', ja: '理由を選択' },
  platformBillingNote: {
    en: 'Note (shown in the audit log)',
    ja: 'メモ（監査ログに表示されます）',
  },
  platformBillingNotePlaceholder: {
    en: 'Why is this needed? Name the ticket or the entry.',
    ja: 'この操作が必要な理由を入力してください。チケットまたはエントリを記載します。',
  },
  platformBillingLinkDocument: {
    en: 'Link a billing document (optional)',
    ja: '請求ドキュメントを関連付ける（任意）',
  },
  platformBillingDocumentId: { en: 'Document ID', ja: 'ドキュメントID' },
  platformBillingDocumentPlaceholder: {
    en: 'receipt_bcp_... or inv_...',
    ja: 'receipt_bcp_… または inv_…',
  },
  platformBillingDebitBlocks: {
    en: 'This debit blocks live environments for {name}.',
    ja: 'この引き落としにより、{name}のライブ環境がブロックされます。',
  },
  platformBillingConfirmAmount: {
    en: 'Type the amount again to confirm',
    ja: '確認のため金額をもう一度入力してください',
  },
  platformBillingSameAmount: { en: 'Same amount as above', ja: '上と同じ金額' },
  platformBillingCancel: { en: 'Cancel', ja: 'キャンセル' },

  // Refund dialog
  platformBillingRefundPurchase: { en: 'Refund purchase', ja: '購入を返金' },
  platformBillingRefundPaid: {
    en: 'paid {amount}. Stripe returns the money to the card, and the balance goes down by the same amount.',
    ja: '支払い額: {amount}。Stripeがカードに返金し、残高も同額減ります。',
  },
  platformBillingRefundAmountUpTo: {
    en: 'Amount (USD), up to {max}',
    ja: '金額（USD）、上限 {max}',
  },
  platformBillingRefundAmountInvalid: {
    en: 'Enter an amount above $0 and up to {max}.',
    ja: '$0を超え{max}以下の金額を入力してください。',
  },
  platformBillingRefundReasonPlaceholder: {
    en: 'Customer refund request',
    ja: 'お客様からの返金リクエスト',
  },
  platformBillingRequestingRefund: {
    en: 'Requesting refund...',
    ja: '返金をリクエストしています…',
  },
  platformBillingRefundAmount: { en: 'Refund {amount}', ja: '{amount}を返金' },

  // Card text
  platformBillingNoCardLower: { en: 'no card on file', ja: 'カード未登録' },
  platformBillingNoCard: { en: 'No card on file', ja: 'カードが登録されていません' },
  platformBillingCardEnding: { en: '{brand} ending {last4}', ja: '{brand}（末尾{last4}）' },
  platformBillingCardEndingState: {
    en: '{brand} ending {last4} ({state})',
    ja: '{brand}（末尾{last4}、{state}）',
  },
  platformBillingCardStateParens: { en: '({state})', ja: '（{state}）' },
  platformBillingCardExpired: { en: 'expired', ja: '期限切れ' },
  platformBillingCardRemoved: { en: 'removed', ja: '削除済み' },

  // Free plan notices
  platformBillingLimitUsers: {
    en: '300 production monthly active users',
    ja: '本番環境の月間アクティブユーザー300人',
  },
  platformBillingLimitSignatures: {
    en: '30,000 production signatures',
    ja: '本番環境の署名30,000回',
  },
  platformBillingBannerCardDue: {
    en: 'Add a card by {date} to keep production running. We do not charge it while you stay inside the Free limits.',
    ja: '本番環境を継続するには、{date}までにカードを追加してください。Freeの上限内であればカードに請求しません。',
  },
  platformBillingBannerCardRequired: {
    en: 'Production is paused until you add a card. Recovery and key export stay open. Development environments keep working.',
    ja: 'カードを追加するまで本番環境は一時停止されます。復旧と鍵のエクスポートは引き続き利用できます。開発環境は引き続き動作します。',
  },
  platformBillingBannerWarningCard: {
    en: 'You used 80% of a Free limit ({limit}). You will move to Growth at the limit.',
    ja: 'Freeの上限（{limit}）の80%を使用しました。上限に達するとGrowthへ移行します。',
  },
  platformBillingBannerWarningNoCard: {
    en: 'You used 80% of a Free limit ({limit}). Add a card before the limit, or production sign-ups and signing stop.',
    ja: 'Freeの上限（{limit}）の80%を使用しました。上限に達する前にカードを追加してください。追加しない場合、本番環境の新規登録と署名が停止します。',
  },
  platformBillingBannerLimitReached: {
    en: 'Production sign-ups or signing are paused: you reached {limit}. Review your card and billing eligibility to start Growth.',
    ja: '{limit}に達したため、本番環境の新規登録または署名が一時停止されています。Growthを開始するには、カードと請求の適格性を確認してください。',
  },
  platformBillingPlanSummaryFree: {
    en: '{plan} plan, {card}. Production this month: {users} of {userLimit} monthly active users, {signatures} of {signatureLimit} signatures.',
    ja: '{plan}プラン、{card}。今月の本番環境: 月間アクティブユーザー {users} / {userLimit}人、署名 {signatures} / {signatureLimit}回。',
  },
  platformBillingPlanSummaryPaid: {
    en: '{plan} plan, {card}. Production this month: {users} monthly active users, {signatures} signatures.',
    ja: '{plan}プラン、{card}。今月の本番環境: 月間アクティブユーザー{users}人、署名{signatures}回。',
  },
  platformBillingFreeSummaryVerified: {
    en: '$0 a month. Your card is verified. Growth starts at $99 a month if you exceed a Free limit.',
    ja: '月額$0です。カードは確認済みです。Freeの上限を超えると、Growthが月額$99で開始されます。',
  },
  platformBillingFreeSummaryBase: { en: '$0 a month.', ja: '月額$0です。' },
  platformBillingFreeSummaryDeadline: {
    en: '$0 a month. Add a card by {date} to keep production running. We do not charge it inside the Free limits.',
    ja: '月額$0です。本番環境を継続するには、{date}までにカードを追加してください。Freeの上限内ではカードに請求しません。',
  },
  platformBillingFreeSummaryAddCard: {
    en: '$0 a month. Add a card to keep production running after the first 30 days.',
    ja: '月額$0です。最初の30日を過ぎても本番環境を継続するには、カードを追加してください。',
  },
  platformBillingOfLimit: { en: 'of {limit}', ja: '/ {limit}' },
  platformBillingOpeningStripe: { en: 'Opening Stripe...', ja: 'Stripeを開いています…' },
  platformBillingAddCard: { en: 'Add a card', ja: 'カードを追加' },
  platformBillingCardSetupCanceled: {
    en: 'Card setup was canceled. No card was added.',
    ja: 'カードの設定がキャンセルされました。カードは追加されていません。',
  },
  platformBillingVerifyingCard: { en: 'Verifying your card...', ja: 'カードを確認しています…' },
  platformBillingStripeNotConfirmed: {
    en: 'Stripe has not confirmed the card yet. Refresh in a moment.',
    ja: 'Stripeがまだカードを確認していません。しばらくしてから更新してください。',
  },
  platformBillingPlanStarted: {
    en: '{plan} started. We charge your card after each month.',
    ja: '{plan}を開始しました。料金は毎月の終了後にカードへ請求します。',
  },
  platformBillingCardVerifiedUse: {
    en: 'Your card is verified. Production uses it from now on.',
    ja: 'カードを確認しました。今後、本番環境ではこのカードが使われます。',
  },
  platformBillingVerificationPending: {
    en: 'Card verification is still pending. Refresh in a moment.',
    ja: 'カードの確認がまだ完了していません。しばらくしてから更新してください。',
  },
  platformBillingCardSetupFailed: {
    en: 'Card setup failed to start.',
    ja: 'カードの設定を開始できませんでした。',
  },
  platformBillingNoticesAria: { en: 'Plan notices', ja: 'プランのお知らせ' },
  platformBillingFreeSummaryAria: { en: 'Free plan summary', ja: 'Freeプランの概要' },
  platformBillingCurrentPlan: { en: 'Current plan', ja: '現在のプラン' },
  platformBillingManagePlan: { en: 'Manage plan', ja: 'プランを管理' },
  platformBillingActiveUsersThisMonth: {
    en: 'Active users this month',
    ja: '今月のアクティブユーザー',
  },
  platformBillingSignaturesThisMonth: { en: 'Signatures this month', ja: '今月の署名' },
  platformBillingCard: { en: 'Card', ja: 'カード' },
  platformBillingQuickStart: { en: 'Integration quick start', ja: '連携のクイックスタート' },
  platformBillingMovedToGrowth: {
    en: 'Your organization moved to Growth',
    ja: '組織はGrowthに移行しました',
  },
  platformBillingGrowthFrom: {
    en: '{amount} a month from {date}.',
    ja: '{date}から月額{amount}です。',
  },
  platformBillingViewBilling: { en: 'View billing', ja: '請求を表示' },
  platformBillingDismissGrowth: { en: 'Dismiss Growth notice', ja: 'Growthのお知らせを閉じる' },
  platformBillingNameOrganization: {
    en: 'Name your organization',
    ja: '組織に名前を付けてください',
  },
  platformBillingDefaultNameNotice: {
    en: 'It still has the default name, “{name}”.',
    ja: '組織名がまだ初期値の「{name}」のままです。',
  },
  platformBillingRename: { en: 'Rename', ja: '名前を変更' },

  // Plan page
  platformBillingChooseOrganizationAria: { en: 'Choose organization', ja: '組織を選択' },
  platformBillingChooseOrganizationTitle: {
    en: 'Choose the organization for this plan',
    ja: 'このプランを適用する組織を選択',
  },
  platformBillingChooseOrganizationNote: {
    en: 'The plan applies to the organization you select.',
    ja: 'プランは選択した組織に適用されます。',
  },
  platformBillingOrganizationSelectionFailed: {
    en: 'Organization selection failed. Try again.',
    ja: '組織を選択できませんでした。もう一度お試しください。',
  },
  platformBillingFeatureFreeUsers: {
    en: 'Up to 300 monthly active users',
    ja: '月間アクティブユーザー300人まで',
  },
  platformBillingFeatureFreeSignatures: {
    en: '30,000 signatures a month',
    ja: '月間30,000回の署名',
  },
  platformBillingFeatureFreeCard: {
    en: 'Card required after 30 days',
    ja: '30日後からカード登録が必要',
  },
  platformBillingFeatureGrowthUsers: {
    en: '5,000 monthly active users included',
    ja: '月間アクティブユーザー5,000人を含む',
  },
  platformBillingFeatureGrowthOver: {
    en: '$0.004 per active user above 5,000',
    ja: '5,000人を超えるアクティブユーザーは1人あたり$0.004',
  },
  platformBillingFeaturePooled: {
    en: '300 signatures per user, pooled',
    ja: 'ユーザー1人あたり月300回の署名をアプリ全体で共有',
  },
  platformBillingFeatureProUsers: {
    en: '100,000 monthly active users included',
    ja: '月間アクティブユーザー100,000人を含む',
  },
  platformBillingFeatureProOver: {
    en: '$0.0035 per active user above 100,000',
    ja: '100,000人を超えるアクティブユーザーは1人あたり$0.0035',
  },
  platformBillingFeatureProSupport: {
    en: 'Uptime SLA and priority support',
    ja: '稼働率SLAと優先サポート',
  },
  platformBillingFreeRequestFailed: {
    en: 'Free request failed.',
    ja: 'Freeのリクエストに失敗しました。',
  },
  platformBillingRequestingFree: { en: 'Requesting Free…', ja: 'Freeをリクエストしています…' },
  platformBillingRequestFreeNextMonth: {
    en: 'Request Free next month',
    ja: '来月からFreeをリクエスト',
  },
  platformBillingFreeRequested: {
    en: 'Free is requested for the next eligible UTC month. Current charges remain due.',
    ja: 'Freeは、次に対象となるUTC月に向けてリクエスト済みです。現在の請求分はお支払いが必要です。',
  },
  platformBillingPlanStartedOn: {
    en: '{plan} started on {date}. We charge your card after each month.',
    ja: '{plan}を{date}に開始しました。料金は毎月の終了後にカードへ請求します。',
  },
  platformBillingOnFreeDeadline: {
    en: 'Your organization is on the Free plan. Add a card by {date} to keep production running.',
    ja: '組織はFreeプランを利用しています。本番環境を継続するには、{date}までにカードを追加してください。',
  },
  platformBillingOnFree: {
    en: 'Your organization is on the Free plan.',
    ja: '組織はFreeプランを利用しています。',
  },
  platformBillingOnPlanSince: {
    en: 'Your organization is on {plan} since {date}.',
    ja: '組織は{date}から{plan}プランを利用しています。',
  },
  platformBillingOnPlan: {
    en: 'Your organization is on {plan}.',
    ja: '組織は{plan}プランを利用しています。',
  },
  platformBillingCardSetupCanceledPlan: {
    en: 'Card setup was canceled. No card was added, and your plan did not change.',
    ja: 'カードの設定がキャンセルされました。カードは追加されておらず、プランも変更されていません。',
  },
  platformBillingCardVerified: { en: 'Your card is verified.', ja: 'カードを確認しました。' },
  platformBillingOpeningDashboard: {
    en: '{message} Opening your dashboard...',
    ja: '{message}ダッシュボードを開いています…',
  },
  platformBillingSetupFailedTryAgain: {
    en: 'Card setup did not start. Try again, or continue on Free.',
    ja: 'カードの設定を開始できませんでした。もう一度お試しいただくか、Freeのまま続行してください。',
  },
  platformBillingAskToStart: {
    en: 'Ask an owner or a billing administrator to start {plan}.',
    ja: 'オーナーまたは請求管理者に{plan}の開始を依頼してください。',
  },
  platformBillingOpenWalletConsole: { en: 'Open the Wallet Console', ja: 'Wallet Consoleを開く' },
  platformBillingPlanPageAria: { en: 'Plan page', ja: 'プランページ' },
  platformBillingLoadingPlan: { en: 'Loading your plan...', ja: 'プランを読み込んでいます…' },
  platformBillingNoBillingAccount: {
    en: 'Your organization has no billing account yet. Create a project first.',
    ja: '組織にはまだ請求アカウントがありません。先にプロジェクトを作成してください。',
  },
  platformBillingContinueOnFree: { en: 'Continue on Free', ja: 'Freeのまま続行' },
  platformBillingIncludedOf: { en: 'of {limit} included', ja: '/ {limit}（含まれる分）' },
  platformBillingPlanAria: { en: '{name} plan', ja: '{name}プラン' },
  platformBillingPerMonth: { en: 'per month', ja: '/月' },
  platformBillingContactToChange: {
    en: 'Contact us to change plans.',
    ja: 'プランを変更するにはお問い合わせください。',
  },
  platformBillingStartingPlan: { en: 'Starting {name}...', ja: '{name}を開始しています…' },
  platformBillingStartPlan: { en: 'Start {name}', ja: '{name}を開始' },
  platformBillingMonthlyFromToday: {
    en: '{price} a month from today, on the {card}.',
    ja: '本日から月額{price}。{card}を使用します。',
  },
  platformBillingAddCardInStripe: {
    en: 'Add a card in Stripe. The plan starts when Stripe confirms it.',
    ja: 'Stripeでカードを追加してください。Stripeが確認するとプランが開始されます。',
  },
  platformBillingEnterpriseDescription: {
    en: 'Committed volume, custom terms, and rollout planning with our team.',
    ja: '確約した利用量、個別の契約条件、チームによる導入計画の支援。',
  },
  platformBillingContactSales: { en: 'Contact sales', ja: '営業に相談' },
} as const satisfies Record<string, Entry>;
