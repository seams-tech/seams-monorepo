import type { Entry } from '../entry';

/* Billing account, invoices, usage costs and billing rules. Prices and limits stay
   numerically identical to the English text. */
export const billingMessages = {
  // Shell
  billingPageLabel: { en: 'Billing page', ja: '請求ページ' },
  billingSessionUnavailable: {
    en: 'Console session is unavailable',
    ja: 'コンソールのセッションを利用できません',
  },
  billingUnauthorized: { en: 'unauthorized', ja: '権限がありません' },
  billingUnavailable: {
    en: 'Billing unavailable: {reason}.',
    ja: '請求を利用できません: {reason}。',
  },
  billingDataUnavailable: {
    en: 'Billing data unavailable: {error}',
    ja: '請求データを利用できません: {error}',
  },
  billingLoadingData: { en: 'Loading billing data', ja: '請求データを読み込み中' },
  billingAdminOnly: {
    en: 'Admin support is only available to platform support accounts.',
    ja: '管理サポートはプラットフォームサポートアカウントのみ利用できます。',
  },
  billingOrgScoped: {
    en: 'Billing is organization-scoped. All projects and services use the same billing account.',
    ja: '請求は組織単位です。すべてのプロジェクトとサービスが同じ請求アカウントを使用します。',
  },
  billingDismissWarningLabel: { en: 'Dismiss billing warning', ja: '請求の警告を閉じる' },
  billingDismiss: { en: 'Dismiss', ja: '閉じる' },
  billingSummaryMetricsLabel: {
    en: 'Billing account summary metrics',
    ja: '請求アカウントの概要指標',
  },
  billingCheckoutCanceled: {
    en: 'Top-up checkout was canceled before settlement.',
    ja: 'チャージのチェックアウトは、決済の完了前にキャンセルされました。',
  },
  billingCheckoutCompletedPending: {
    en: 'Top-up checkout completed. Balance updates after settlement confirmation.',
    ja: 'チャージのチェックアウトが完了しました。残高は決済の確認後に更新されます。',
  },
  billingCheckoutVerifying: {
    en: 'Top-up checkout completed. Verifying settlement...',
    ja: 'チャージのチェックアウトが完了しました。決済を確認しています…',
  },
  billingCheckoutUpdated: {
    en: 'Top-up checkout completed. Balance updated.',
    ja: 'チャージのチェックアウトが完了しました。残高を更新しました。',
  },
  billingCheckoutAlreadySettled: {
    en: 'Top-up checkout is already settled. Balance is up to date.',
    ja: 'チャージのチェックアウトは決済済みです。残高は最新です。',
  },
  billingCheckoutVerifyPending: {
    en: 'Top-up checkout completed, but settlement verification is still pending. Refresh again in a moment.',
    ja: 'チャージのチェックアウトは完了しましたが、決済の確認がまだ完了していません。しばらくしてからもう一度更新してください。',
  },
  billingBalanceDepleted: {
    en: 'Prepaid balance is depleted. Add credits to fund service usage.',
    ja: 'プリペイド残高がなくなりました。サービスの使用分に充てるクレジットを追加してください。',
  },
  billingBalanceLow: {
    en: 'Prepaid balance is at or below the warning threshold ({threshold}). Add credits before service usage increases.',
    ja: 'プリペイド残高が警告のしきい値（{threshold}）以下です。サービスの使用量が増える前にクレジットを追加してください。',
  },
  billingDownloadFailed: {
    en: 'Failed to download {filename}: {error}',
    ja: '{filename}をダウンロードできませんでした: {error}',
  },

  // Account summary metrics
  billingMetricBalance: { en: 'Balance', ja: '残高' },
  billingMetricBalanceHint: { en: 'Posted organization balance', ja: '計上済みの組織の残高' },
  billingMetricAvailableBalance: { en: 'Available balance', ja: '利用可能残高' },
  billingMetricAvailableBalanceHint: {
    en: 'Balance after reserved funds and pending refunds',
    ja: '予約済み資金と保留中の返金を差し引いた後の残高',
  },
  billingMetricReservedFunds: { en: 'Reserved funds', ja: '予約済み資金' },
  billingReservationsOne: {
    en: '{count} unresolved reservation',
    ja: '未解決の予約{count}件',
  },
  billingReservationsMany: {
    en: '{count} unresolved reservations',
    ja: '未解決の予約{count}件',
  },
  billingMetricPendingRefunds: { en: 'Pending refunds', ja: '保留中の返金' },
  billingMetricPendingRefundsHint: {
    en: 'Funds held while refunds are processed',
    ja: '返金の処理中に保留される資金',
  },
  billingMetricRecentTopUps: { en: 'Recent top-ups', ja: '最近のチャージ' },
  billingDocumentsCountOne: { en: '{count} billing document', ja: '請求ドキュメント{count}件' },
  billingDocumentsCountMany: { en: '{count} billing documents', ja: '請求ドキュメント{count}件' },

  // Invoice list metrics
  billingMetricDocuments: { en: 'Documents', ja: 'ドキュメント' },
  billingStatementsCountOne: { en: '{count} statement', ja: '明細書{count}件' },
  billingStatementsCountMany: { en: '{count} statements', ja: '明細書{count}件' },
  billingMetricPurchaseReceipts: { en: 'Purchase receipts', ja: '購入領収書' },
  billingPaidDocumentsOne: { en: '{count} paid document', ja: '支払い済みドキュメント{count}件' },
  billingPaidDocumentsMany: { en: '{count} paid documents', ja: '支払い済みドキュメント{count}件' },
  billingMetricOutstanding: { en: 'Outstanding', ja: '未払い残高' },
  billingOpenCount: { en: '{count} open', ja: '未払い{count}件' },
  billingMetricLatestPeriod: { en: 'Latest period', ja: '最新の期間' },
  billingMetricLatestPeriodHint: { en: 'Most recent billing month', ja: '直近の請求月' },

  // Shared
  billingOrganizationWide: { en: 'Organization-wide', ja: '組織全体' },
  billingSharedNoteAccount: {
    en: 'The card, prepaid balance, plan, and invoices are shared by every product in this organization. Usage costs below count {service} only.',
    ja: 'カード、プリペイド残高、プラン、請求書は、この組織のすべてのプロダクトで共有されます。以下の使用コストは{service}のみを対象としています。',
  },
  billingSharedNoteInvoices: {
    en: 'Invoices and receipts are shared by every product in this organization. They can include usage from products other than {service}.',
    ja: '請求書と領収書は、この組織のすべてのプロダクトで共有されます。{service}以外のプロダクトの使用分が含まれる場合があります。',
  },
  billingStatusUnknown: { en: 'Unknown', ja: '不明' },
  billingStatusActionRequired: { en: 'Action Required', ja: '対応が必要' },
  billingStatusCreated: { en: 'Created', ja: '作成済み' },
  billingStatusPending: { en: 'Pending', ja: '保留中' },
  billingStatusConfirming: { en: 'Confirming', ja: '確認中' },
  billingStatusOpen: { en: 'Open', ja: '未払い' },
  billingStatusPastDue: { en: 'Past Due', ja: '支払い期限超過' },
  billingStatusPaid: { en: 'Paid', ja: '支払い済み' },
  billingStatusSettled: { en: 'Settled', ja: '決済済み' },
  billingStatusPartiallySettled: { en: 'Partially Settled', ja: '一部決済済み' },
  billingStatusOverpaid: { en: 'Overpaid', ja: '過払い' },
  billingStatusVoid: { en: 'Void', ja: '無効' },
  billingStatusCanceled: { en: 'Canceled', ja: 'キャンセル済み' },
  billingStatusExpired: { en: 'Expired', ja: '期限切れ' },
  billingStatusUncollectible: { en: 'Uncollectible', ja: '回収不能' },
  billingStatusFailed: { en: 'Failed', ja: '失敗' },
  billingStatusDisputed: { en: 'Disputed', ja: '不審請求中' },
  billingDocPurchaseReceipt: { en: 'Purchase receipt', ja: '購入領収書' },
  billingDocUsageStatement: { en: 'Usage statement', ja: '使用量明細書' },
  billingDocMonthlyInvoice: { en: 'Monthly invoice', ja: '月次請求書' },

  // Top-up and refunds
  billingTopUpOption10: {
    en: 'Quick prepaid top-up for test traffic.',
    ja: 'テスト用トラフィック向けの手軽なプリペイドチャージ。',
  },
  billingTopUpOption25: {
    en: 'Starter prepaid balance for light production.',
    ja: '小規模な本番運用向けの初期プリペイド残高。',
  },
  billingTopUpOption50: {
    en: 'Larger one-time top-up for ongoing usage.',
    ja: '継続的な使用向けの、より大きな1回限りのチャージ。',
  },
  billingRefundRequested: { en: 'Requested', ja: 'リクエスト済み' },
  billingRefundProcessing: { en: 'Processing', ja: '処理中' },
  billingRefundRefunded: { en: 'Refunded', ja: '返金済み' },
  billingRefundFailed: { en: 'Failed', ja: '失敗' },
  billingRefundCanceled: { en: 'Canceled', ja: 'キャンセル済み' },
  billingStartingCheckout: { en: 'Starting checkout...', ja: 'チェックアウトを開始しています…' },
  billingBuyAmount: { en: 'Buy {amount}', ja: '{amount}を購入' },
  billingTopUpActionsLabel: { en: 'Prepaid top-up actions', ja: 'プリペイドのチャージ操作' },
  billingTopUpTitle: { en: 'Top up credits', ja: 'クレジットをチャージ' },
  billingTopUpIntro: {
    en: 'Start a one-time Stripe checkout to add prepaid balance. Settled purchases appear in billing documents as purchase receipts.',
    ja: 'Stripeの1回限りのチェックアウトを開始して、プリペイド残高を追加します。決済が完了した購入は、請求ドキュメントに購入領収書として表示されます。',
  },
  billingTopUpNeedsAccess: {
    en: 'Organization billing management access is required to buy credits.',
    ja: 'クレジットを購入するには、組織の請求管理権限が必要です。',
  },
  billingTopUpAmountLabel: { en: 'Top-up amount', ja: 'チャージ金額' },
  billingRefundHistory: { en: 'Refund history', ja: '返金履歴' },
  billingRefundHistoryIntro: {
    en: 'Refunds requested through support appear here as Stripe processes them.',
    ja: 'サポートを通じてリクエストした返金は、Stripeの処理に合わせてここに表示されます。',
  },
  billingRefundHistoryLoading: { en: 'Loading refund history...', ja: '返金履歴を読み込み中…' },
  billingRefundHistoryEmpty: {
    en: 'No refunds have been issued.',
    ja: '返金はまだ行われていません。',
  },
  billingRefundTitle: { en: '{amount} refund', ja: '{amount}の返金' },
  billingRefundPurchase: { en: 'Purchase {id}', ja: '購入 {id}' },

  // Invoices list
  billingDocumentSummaryMetricsLabel: {
    en: 'Billing document summary metrics',
    ja: '請求ドキュメントの概要指標',
  },
  billingReceiptsAndStatements: { en: 'Receipts and statements', ja: '領収書と明細書' },
  billingDocumentFiltersLabel: {
    en: 'Billing document filters',
    ja: '請求ドキュメントのフィルター',
  },
  billingDocumentType: { en: 'Document type', ja: 'ドキュメントの種類' },
  billingAllDocuments: { en: 'All documents', ja: 'すべてのドキュメント' },
  billingPurchaseReceiptsPlural: { en: 'Purchase receipts', ja: '購入領収書' },
  billingUsageStatementsPlural: { en: 'Usage statements', ja: '使用量明細書' },
  billingMonthlyInvoicesPlural: { en: 'Monthly invoices', ja: '月次請求書' },
  billingStatus: { en: 'Status', ja: 'ステータス' },
  billingAllStatuses: { en: 'All statuses', ja: 'すべてのステータス' },
  billingFilterOpen: { en: 'Open', ja: '未払い' },
  billingFilterOverdue: { en: 'Overdue', ja: '期限超過' },
  billingFilterPaid: { en: 'Paid', ja: '支払い済み' },
  billingFilterVoid: { en: 'Void', ja: '無効' },
  billingFilterUncollectible: { en: 'Uncollectible', ja: '回収不能' },
  billingStartDate: { en: 'Start date', ja: '開始日' },
  billingEndDate: { en: 'End date', ja: '終了日' },
  billingDocumentsTableLabel: { en: 'Billing documents table', ja: '請求ドキュメントの表' },
  billingColDocumentId: { en: 'Document ID', ja: 'ドキュメントID' },
  billingColType: { en: 'Type', ja: '種類' },
  billingColStatus: { en: 'Status', ja: 'ステータス' },
  billingColPeriod: { en: 'Period', ja: '期間' },
  billingColCreated: { en: 'Created', ja: '作成日時' },
  billingColAmount: { en: 'Amount', ja: '金額' },
  billingColPaid: { en: 'Paid', ja: '支払い済み' },
  billingColActions: { en: 'Actions', ja: '操作' },
  billingLoadingDocuments: { en: 'Loading billing documents', ja: '請求ドキュメントを読み込み中' },
  billingNoDocumentsMatch: {
    en: 'No documents match the current filters.',
    ja: '現在のフィルターに一致するドキュメントはありません。',
  },
  billingNoDocuments: { en: 'No billing documents yet.', ja: '請求ドキュメントはまだありません。' },
  billingViewDocumentLabel: { en: 'View document', ja: 'ドキュメントを表示' },
  billingView: { en: 'View', ja: '表示' },
  billingDownloadingPdf: { en: 'Downloading PDF', ja: 'PDFをダウンロード中' },
  billingDownloadPdf: { en: 'Download PDF', ja: 'PDFをダウンロード' },
  billingDownloadingPdfEllipsis: { en: 'Downloading PDF...', ja: 'PDFをダウンロード中…' },
  billingItemDocument: { en: 'document', ja: 'ドキュメント' },
  billingItemDocuments: { en: 'documents', ja: 'ドキュメント' },
  billingItemLineItem: { en: 'line item', ja: '明細行' },
  billingItemLineItems: { en: 'line items', ja: '明細行' },
  billingItemEvent: { en: 'event', ja: 'イベント' },
  billingItemEvents: { en: 'events', ja: 'イベント' },

  // Invoice detail
  billingDocumentDetailHeader: {
    en: 'Billing document detail header',
    ja: '請求ドキュメントの詳細ヘッダー',
  },
  billingBackToInvoices: { en: 'Back to invoices', ja: '請求書に戻る' },
  billingDocumentEyebrow: { en: 'Billing document', ja: '請求ドキュメント' },
  billingDocumentIntro: {
    en: 'View document status, line items, and recorded ledger activity.',
    ja: 'ドキュメントのステータス、明細行、記録された台帳アクティビティを確認できます。',
  },
  billingLoadingDocument: { en: 'Loading billing document', ja: '請求ドキュメントを読み込み中' },
  billingDocumentUnavailable: {
    en: 'Billing document unavailable: {error}',
    ja: '請求ドキュメントを利用できません: {error}',
  },
  billingDocumentNotFound: {
    en: 'Billing document {id} was not found.',
    ja: '請求ドキュメント{id}が見つかりません。',
  },
  billingMetricDocumentFallback: { en: 'Document', ja: 'ドキュメント' },
  billingMetricStatus: { en: 'Status', ja: 'ステータス' },
  billingStatusHintReceipt: {
    en: 'Settled prepaid credit purchase',
    ja: '決済済みのプリペイドクレジット購入',
  },
  billingStatusHintStatement: {
    en: 'Generated from recorded prepaid usage',
    ja: '記録されたプリペイド使用量から生成',
  },
  billingMetricAmount: { en: 'Amount', ja: '金額' },
  billingPaidAmount: { en: 'Paid {amount}', ja: '支払い済み {amount}' },
  billingMetricPeriod: { en: 'Period', ja: '期間' },
  billingCreatedAt: { en: 'Created {time}', ja: '作成日時 {time}' },
  billingDocumentAccountActivityLabel: {
    en: 'Billing document account activity',
    ja: '請求ドキュメントのアカウントアクティビティ',
  },
  billingUsageStatementNote: {
    en: 'Review service costs for this billing period in {usageLink}. Review posted financial movements in {activityLink}.',
    ja: 'この請求期間のサービスコストは{usageLink}で確認できます。計上済みの入出金は{activityLink}で確認できます。',
  },
  billingUsageCostsLink: { en: 'Usage costs', ja: '使用コスト' },
  billingAccountActivityLink: { en: 'Account activity', ja: 'アカウントアクティビティ' },
  billingActivityTimelineLabel: {
    en: 'Billing document activity timeline',
    ja: '請求ドキュメントのアクティビティタイムライン',
  },
  billingDocumentActivity: { en: 'Document activity', ja: 'ドキュメントのアクティビティ' },
  billingDocumentActivityIntro: {
    en: 'Review document creation and ledger activity in one chronological feed.',
    ja: 'ドキュメントの作成と台帳アクティビティを、時系列のフィードでまとめて確認できます。',
  },
  billingInternalNote: {
    en: 'Internal manual adjustments are visible in this staff timeline only and are excluded from exported PDFs.',
    ja: '社内の手動調整は、このスタッフ向けタイムラインにのみ表示され、エクスポートしたPDFには含まれません。',
  },
  billingLoadingDocumentActivity: {
    en: 'Loading document activity...',
    ja: 'ドキュメントのアクティビティを読み込み中…',
  },
  billingInternalOnly: { en: 'Internal only', ja: '社内のみ' },
  billingNoDocumentActivity: {
    en: 'No document activity has been recorded yet.',
    ja: 'ドキュメントのアクティビティはまだ記録されていません。',
  },
  billingLineItemsTableLabel: { en: 'Billing document line items', ja: '請求ドキュメントの明細行' },
  billingLineItems: { en: 'Line items', ja: '明細行' },
  billingLineItemsIntro: {
    en: 'Review the billed or credited components captured in this document snapshot.',
    ja: 'このドキュメントのスナップショットに記録された、請求または返金の内訳を確認できます。',
  },
  billingColLineItemId: { en: 'Line item ID', ja: '明細行ID' },
  billingColDescription: { en: 'Description', ja: '説明' },
  billingColQuantity: { en: 'Quantity', ja: '数量' },
  billingColUnitAmount: { en: 'Unit amount', ja: '単価' },
  billingColDocument: { en: 'Document', ja: 'ドキュメント' },
  billingLoadingLineItems: { en: 'Loading line items', ja: '明細行を読み込み中' },
  billingLineItemsUnavailable: {
    en: 'Line items unavailable: {error}',
    ja: '明細行を利用できません: {error}',
  },
  billingNoLineItems: {
    en: 'No line items for this document.',
    ja: 'このドキュメントには明細行がありません。',
  },
  billingItemPlanBaseFee: { en: 'Plan base fee', ja: 'プランの基本料金' },
  billingItemSigningUsage: { en: 'Signing usage', ja: '署名の使用量' },
  billingItemExecutionUsage: { en: 'Execution usage', ja: '実行の使用量' },
  billingItemCreditPurchase: { en: 'Credit purchase', ja: 'クレジット購入' },
  billingItemActiveResourceUsage: { en: 'Active resource usage', ja: 'アクティブリソースの使用量' },
  billingItemAdjustment: { en: 'Adjustment', ja: '調整' },

  // Usage costs
  billingHistoricalCharges: {
    en: 'Historical unattributed organization charges',
    ja: '過去の帰属先不明の組織料金',
  },
  billingDimensionProject: { en: 'project', ja: 'プロジェクト' },
  billingDimensionService: { en: 'service', ja: 'サービス' },
  billingDimensionMeter: { en: 'meter', ja: 'メーター' },
  billingCostByDimensionLabel: {
    en: 'Usage cost by {dimension}',
    ja: '{dimension}別の使用コスト',
  },
  billingCostByDimension: { en: 'By {dimension}', ja: '{dimension}別' },
  billingNoUsageCosts: {
    en: 'No usage costs were posted in this period.',
    ja: 'この期間に計上された使用コストはありません。',
  },
  billingPostedUsageCost: { en: 'Posted usage cost', ja: '計上済みの使用コスト' },
  billingUsageCostsUnavailableOrg: {
    en: 'Usage costs are unavailable for this organization.',
    ja: 'この組織の使用コストを利用できません。',
  },
  billingLoadingUsageCosts: { en: 'Loading usage costs', ja: '使用コストを読み込み中' },
  billingUsageCostsUnavailable: {
    en: 'Usage costs unavailable: {error}',
    ja: '使用コストを利用できません: {error}',
  },
  billingUsageCostsMismatch: {
    en: 'Usage costs did not match this organization.',
    ja: '使用コストがこの組織と一致しませんでした。',
  },
  billingServiceUsageCostsLabel: { en: '{service} usage costs', ja: '{service}の使用コスト' },
  billingOrgUsageCostsLabel: { en: 'Organization usage costs', ja: '組織の使用コスト' },
  billingUsageCostMonth: { en: 'Usage cost month (UTC)', ja: '使用コストの月（UTC）' },
  billingPostedUsageIntro: {
    en: 'Posted service usage for {period} (UTC). Payments, refunds, disputes, and manual adjustments remain in account activity.',
    ja: '{period}（UTC）に計上されたサービスの使用量です。支払い、返金、不審請求、手動調整はアカウントアクティビティに残ります。',
  },
  billingPostedUsageTotalLabel: { en: 'Posted usage total', ja: '計上済みの使用量合計' },
  billingSubjectOrganization: { en: 'Organization', ja: '組織' },
  billingCostTotalHint: { en: '{subject} total for {period}', ja: '{period}の{subject}合計' },
  billingServiceOnlyNote: {
    en: 'Only {service} usage is shown. Usage of other products and historical organization charges are in {platformLink}.',
    ja: '{service}の使用量のみ表示しています。他のプロダクトの使用量と過去の組織料金は{platformLink}で確認できます。',
  },
  billingPlatformConsoleLink: { en: 'Platform Console', ja: 'Platform Console' },
  billingIdsNote: {
    en: 'Project, service, and meter IDs identify attributable costs. Historical charges without source evidence remain organization charges.',
    ja: 'プロジェクト、サービス、メーターのIDで、帰属可能なコストを識別します。発生元の根拠がない過去の料金は、組織の料金として残ります。',
  },

  // Account activity
  billingActivityManualCredit: { en: 'Manual support credit', ja: 'サポートによる手動クレジット' },
  billingActivityManualDebit: { en: 'Manual admin debit', ja: '管理者による手動引き落とし' },
  billingActivityPlanBase: { en: 'Plan base fee', ja: 'プランの基本料金' },
  billingActivityPlanUsageCharge: { en: 'Plan usage charge', ja: 'プランの使用料金' },
  billingActivityPlanUsageCredit: { en: 'Plan usage credit', ja: 'プランの使用量クレジット' },
  billingActivityInvoicePayment: { en: 'Monthly invoice payment', ja: '月次請求書の支払い' },
  billingActivityCreditPurchase: { en: 'Credit purchase settled', ja: 'クレジット購入の決済完了' },
  billingActivityUsageDebit: { en: 'Usage debit recorded', ja: '使用量の引き落としを記録' },
  billingActivityExecutionDebit: {
    en: 'Sponsored execution debit recorded',
    ja: 'スポンサー付き実行の引き落としを記録',
  },
  billingActivityDocumentLabel: { en: 'Document', ja: 'ドキュメント' },
  billingActivityPurchaseLabel: { en: 'Purchase', ja: '購入' },
  billingActivityActorUser: { en: 'Actor {id}', ja: '実行者 {id}' },
  billingActivityEvent: { en: 'Event {id}', ja: 'イベント {id}' },
  billingActivityPeriod: { en: 'Period {month}', ja: '期間 {month}' },
  billingContextOrganization: { en: 'Organization', ja: '組織' },
  billingContextProject: { en: 'Project', ja: 'プロジェクト' },
  billingContextEnvironment: { en: 'Environment', ja: '環境' },
  billingCustomerActivityLabel: {
    en: 'Customer account activity',
    ja: 'カスタマーアカウントのアクティビティ',
  },
  billingCustomerActivityTitle: {
    en: 'Customer Account activity',
    ja: 'カスタマーアカウントのアクティビティ',
  },
  billingCustomerActivityIntro: {
    en: 'Latest ledger events for the resolved billing account.',
    ja: '対象の請求アカウントの最新の台帳イベント。',
  },
  billingNoActivity: {
    en: 'No billing activity has been recorded yet.',
    ja: '請求アクティビティはまだ記録されていません。',
  },
  billingColWhenUtc: { en: 'When (UTC)', ja: '日時（UTC）' },
  billingColReason: { en: 'Reason', ja: '理由' },
  billingColSummary: { en: 'Summary', ja: '概要' },

  // Payment account panel
  billingPaymentLoading: {
    en: 'Loading payment account…',
    ja: 'お支払いアカウントを読み込み中…',
  },
  billingRequestFailed: { en: 'Billing request failed', ja: '請求のリクエストに失敗しました' },
  billingActionFailed: { en: 'Billing action failed', ja: '請求の操作に失敗しました' },
  billingMonthlyBilling: { en: 'Monthly billing', ja: '月次請求' },
  billingMonthlyCreditSummary: {
    en: 'Approved credit: {limit}. Unpaid charges: {unpaid}. Execution commitments: {held}. Available credit: {available}.',
    ja: '承認済みクレジット枠: {limit}。未払い料金: {unpaid}。実行コミット額: {held}。利用可能なクレジット: {available}。',
  },
  billingMonthlyInvoiceNote: {
    en: 'Invoices close after each UTC month. Amounts below $0.50 carry to the next invoice. Contact support to request a credit limit change.',
    ja: '請求書は毎月のUTC月の終了後に締められます。$0.50未満の金額は次の請求書に繰り越されます。クレジット上限の変更をご希望の場合は、サポートにお問い合わせください。',
  },
  billingGraceEnds: {
    en: 'Payment grace ends {time}. Replace your card above, then pay the open invoice.',
    ja: '支払いの猶予期間は{time}に終了します。上のカードを置き換えてから、未払いの請求書を支払ってください。',
  },
  billingCollectionBlocked: {
    en: 'Invoice collection requires support review before new paid work can resume.',
    ja: '新しい有料の処理を再開するには、請求書の回収についてサポートの確認が必要です。',
  },
  billingColMonth: { en: 'Month', ja: '月' },
  billingColPayment: { en: 'Payment', ja: 'お支払い' },
  billingOpenInvoiceOrPay: { en: 'Open invoice or pay', ja: '請求書を開く・支払う' },
  billingCarriedToNextMonth: { en: 'Carried to next month', ja: '翌月に繰り越し' },
  billingNoMonthlyInvoices: { en: 'No monthly invoices yet.', ja: '月次請求書はまだありません。' },
  billingRefreshPaymentStatus: { en: 'Refresh payment status', ja: 'お支払い状況を更新' },
  billingManagePlan: { en: 'Manage plan', ja: 'プランを管理' },

  // Billing rules
  billingRulesTitle: { en: 'Billing rules', ja: '請求ルール' },
  billingRulesIntro: {
    en: 'Projects and services share one organization billing account. Prices are in USD. Billing months follow the UTC calendar.',
    ja: 'プロジェクトとサービスは、1つの組織の請求アカウントを共有します。料金はUSDで表示されます。請求月はUTCカレンダーに従います。',
  },
  billingRulesSummary: {
    en: 'Read how usage, invoices, and payment limits work',
    ja: '使用量、請求書、支払い上限の仕組みを確認する',
  },
  billingRulesMauTitle: { en: 'Monthly active users', ja: '月間アクティブユーザー' },
  billingRulesMauBody: {
    en: 'A production user counts after registration, sign-in, or a session refresh during the month. Each user identity counts once that month. Repeated logins and signatures do not add another MAU. A login that creates a new charge must fit the available credit. Recovery and key export stay available. Development environments do not count toward Wallet plan usage.',
    ja: '本番環境のユーザーは、その月に登録、サインイン、またはセッションの更新を行った時点でカウントされます。各ユーザーIDは、その月に1回だけカウントされます。繰り返しのサインインや署名によって、MAUが増えることはありません。新たな料金が発生するサインインは、利用可能なクレジットの範囲内である必要があります。リカバリーと鍵のエクスポートは引き続き利用できます。開発環境は、Walletプランの使用量に含まれません。',
  },
  billingRulesPlansTitle: { en: 'Free and paid plans', ja: 'Freeと有料プラン' },
  billingRulesFreeBody: {
    en: 'Free includes 300 production active users and 30,000 monthly signatures. Production requires a usable card after 30 days. Reaching a Free limit starts Growth when the card and billing account are eligible. Otherwise, new production sign-ups and signing pause. Recovery and key export stay available.',
    ja: 'Freeには、本番環境のアクティブユーザー300人と月間30,000件の署名が含まれます。30日後は、本番環境の利用に有効なカードが必要です。Freeの上限に達すると、カードと請求アカウントが条件を満たしている場合はGrowthが開始されます。条件を満たさない場合、本番環境の新規登録と署名は一時停止します。リカバリーと鍵のエクスポートは引き続き利用できます。',
  },
  billingRulesPlanPageBody: {
    en: 'The {planLink} shows prices and included usage. Paid plans pool the signature allowance across their monthly active users. Base fees start on activation. The first month is prorated. Accepted charges keep their recorded price.',
    ja: '{planLink}に、料金と含まれる使用量が表示されます。有料プランでは、署名の許容量が月間アクティブユーザー全体で共有されます。基本料金は有効化の時点から発生し、初月は日割りで計算されます。承認済みの料金は、記録された価格のまま維持されます。',
  },
  billingRulesPlanPageLink: { en: 'plan page', ja: 'プランページ' },
  billingRulesInvoicesTitle: { en: 'Monthly invoices', ja: '月次請求書' },
  billingRulesInvoicesBody: {
    en: 'Monthly postpaid billing combines plan fees and usage after the month ends. Amounts below USD 0.50 carry forward. Late usage appears on a later invoice with its original usage month. Usage credits reduce a later invoice and retain their billing history.',
    ja: '月次の後払い請求では、月の終了後にプラン料金と使用量をまとめて請求します。USD 0.50未満の金額は翌月に繰り越されます。遅れて届いた使用量は、元の使用月を付けて後の請求書に表示されます。使用量クレジットは後の請求書から差し引かれ、請求履歴は保持されます。',
  },
  billingRulesCreditTitle: { en: 'Credit and reservations', ja: 'クレジットと予約' },
  billingRulesCreditBody: {
    en: 'Available credit is the approved limit minus unpaid charges and execution commitments. We reserve credit before paid work and replace the reservation with its final charge. If an execution outcome is unknown, its reservation remains until the service resolves it. A saved card does not grant a credit limit.',
    ja: '利用可能なクレジットは、承認済みの上限額から未払い料金と実行コミット額を差し引いた額です。有料の処理の前にクレジットを予約し、予約を最終的な料金に置き換えます。実行結果が不明な場合、サービスが解決するまで予約は残ります。保存済みのカードがあっても、クレジット上限は付与されません。',
  },
  billingRulesFailedTitle: { en: 'Failed payments', ja: '支払いの失敗' },
  billingRulesFailedBody: {
    en: 'The first recorded payment failure starts a seven-day grace period. Credit limits still apply during grace. New paid work stops when grace expires or credit is exhausted. Replacing a card preserves the deadline and leaves existing invoices due. Use the invoice payment link to settle them.',
    ja: '支払いの失敗が最初に記録された時点から、7日間の猶予期間が始まります。猶予期間中もクレジット上限は適用されます。猶予期間が終了するか、クレジットを使い切ると、新しい有料の処理は停止します。カードを置き換えても期限は維持され、既存の請求書は未払いのままです。請求書の支払いリンクから支払ってください。',
  },
  billingRulesReturnTitle: { en: 'Returning to Free', ja: 'Freeに戻す場合' },
  billingRulesReturnBody: {
    en: 'Request Free for the next eligible UTC month. Usage must fit the Free limits. Open invoices and accepted work must resolve before the transition completes. Accrued charges remain due, and the original card deadline remains in effect.',
    ja: '次の対象となるUTC月からFreeに戻すには、リクエストしてください。使用量がFreeの上限内である必要があります。移行が完了する前に、未払いの請求書と承認済みの処理を解決する必要があります。発生済みの料金は引き続き支払い対象で、元のカード期限も維持されます。',
  },
  billingRulesPrepaidTitle: { en: 'Prepaid accounts', ja: 'プリペイドアカウント' },
  billingRulesPrepaidBody: {
    en: 'Prepaid purchases add balance and produce purchase receipts. Existing prepaid history remains available. Moving to postpaid requires approval, a usable card, zero prepaid balance, and no unsettled billing obligations.',
    ja: 'プリペイドの購入で残高が追加され、購入領収書が発行されます。既存のプリペイド履歴は引き続き利用できます。後払いに切り替えるには、承認、有効なカード、プリペイド残高ゼロ、未精算の請求義務がないことが必要です。',
  },
} as const satisfies Record<string, Entry>;
