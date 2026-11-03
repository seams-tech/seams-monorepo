import type { Entry } from '../entry';

export const auditObservabilityMessages = {
  // Shared by the audit, observability and overview pages
  auditSessionUnavailable: {
    en: 'Console session is unavailable',
    ja: 'コンソールのセッションを利用できません',
  },
  auditUnknownError: { en: 'Unknown error', ja: '不明なエラー' },
  auditFilterAll: { en: 'All', ja: 'すべて' },
  auditView: { en: 'View', ja: '表示' },
  auditHide: { en: 'Hide', ja: '非表示' },
  auditTimestamp: { en: 'Timestamp', ja: 'タイムスタンプ' },
  auditEvent: { en: 'Event', ja: 'イベント' },
  auditDetails: { en: 'Details', ja: '詳細' },
  auditEventItemLabel: { en: 'event', ja: 'イベント' },
  auditEventItemLabelPlural: { en: 'events', ja: 'イベント' },

  // Time ranges
  auditRangeLastHour: { en: 'Last hour', ja: '過去1時間' },
  auditRangeLast24Hours: { en: 'Last 24 hours', ja: '過去24時間' },
  auditRangeLast7Days: { en: 'Last 7 days', ja: '過去7日間' },
  auditRangeLast30Days: { en: 'Last 30 days', ja: '過去30日間' },
  auditRangeLastSpan: { en: 'Last {span}', ja: '過去{span}' },
  auditSpanMinuteOne: { en: '{count} minute', ja: '{count}分' },
  auditSpanMinuteMany: { en: '{count} minutes', ja: '{count}分' },
  auditSpanHourOne: { en: '{count} hour', ja: '{count}時間' },
  auditSpanHourMany: { en: '{count} hours', ja: '{count}時間' },
  auditSpanDayOne: { en: '{count} day', ja: '{count}日間' },
  auditSpanDayMany: { en: '{count} days', ja: '{count}日間' },

  // Filter chips
  auditEventFilters: { en: 'Audit event filters', ja: '監査イベントのフィルター' },
  auditClearFilter: { en: 'Clear {filter} filter', ja: '{filter}フィルターをクリア' },
  auditClearAllFilters: { en: 'Clear all filters', ja: 'すべてのフィルターをクリア' },
  auditFilterCategory: { en: 'Category', ja: 'カテゴリ' },
  auditFilterOutcome: { en: 'Outcome', ja: '結果' },
  auditFilterActor: { en: 'Actor', ja: '実行者' },

  // Categories
  auditCategoryPolicy: { en: 'Policy', ja: 'ポリシー' },
  auditCategorySettings: { en: 'Settings', ja: '設定' },
  auditCategoryKeyExport: { en: 'Key export', ja: '鍵のエクスポート' },
  auditCategoryBilling: { en: 'Billing', ja: '請求' },
  auditCategoryWebhook: { en: 'Webhook', ja: 'Webhook' },
  auditCategoryApiKey: { en: 'API keys', ja: 'APIキー' },
  auditCategoryTeam: { en: 'Team', ja: 'チーム' },
  auditCategoryApproval: { en: 'Approval', ja: '承認' },
  auditCategoryOrgProjectEnv: { en: 'Org / project / env', ja: '組織 / プロジェクト / 環境' },
  auditCategoryRuntimeSnapshot: { en: 'Runtime snapshot', ja: 'ランタイムスナップショット' },
  auditCategorySystem: { en: 'System', ja: 'システム' },

  // Outcomes
  auditOutcomeSuccess: { en: 'Success', ja: '成功' },
  auditOutcomeFailure: { en: 'Failure', ja: '失敗' },
  auditOutcomePending: { en: 'Pending', ja: '保留中' },

  // Actor types
  auditActorTypeUser: { en: 'User', ja: 'ユーザー' },
  auditActorTypeSystem: { en: 'System', ja: 'システム' },

  // Activity chart
  auditChartLabel: { en: 'Audit event activity', ja: '監査イベントのアクティビティ' },
  auditChartLoading: {
    en: 'Loading audit event activity',
    ja: '監査イベントのアクティビティを読み込み中…',
  },
  auditChartEventsOne: { en: '{count} audit event', ja: '監査イベント{count}件' },
  auditChartEventsMany: { en: '{count} audit events', ja: '監査イベント{count}件' },
  auditChartFailed: { en: ', {count} failed', ja: '、失敗{count}件' },
  auditChartSummary: {
    en: '{events}{failed} between {from} and {to}',
    ja: '{from}から{to}までの{events}{failed}',
  },
  auditBarEventsOne: { en: '{count} event', ja: 'イベント{count}件' },
  auditBarEventsMany: { en: '{count} events', ja: 'イベント{count}件' },
  auditBarTitle: { en: '{time} — {events}{failed}', ja: '{time} — {events}{failed}' },
  auditPreviousPeriod: { en: 'Previous period', ja: '前の期間' },
  auditNextPeriod: { en: 'Next period', ja: '次の期間' },
  auditJumpToTimestamp: { en: 'Jump to timestamp', ja: '日時へ移動' },
  auditCentreWindowOn: { en: 'Centre the window on', ja: 'ウィンドウの中心にする日時' },
  auditCancel: { en: 'Cancel', ja: 'キャンセル' },
  auditJump: { en: 'Jump', ja: '移動' },
  auditFocusToSelection: { en: 'Focus to selection', ja: '選択範囲に絞り込む' },

  // Page chrome
  auditPageLabel: { en: 'Audit logs page', ja: '監査ログページ' },
  auditEventsTableLabel: { en: 'Audit events table', ja: '監査イベントのテーブル' },
  auditEventsLabel: { en: 'Audit events', ja: '監査イベント' },
  auditSearchEvents: { en: 'Search events', ja: 'イベントを検索' },
  auditSearchPlaceholder: {
    en: 'Search action, summary, or actor...',
    ja: 'アクション、概要、実行者を検索…',
  },
  auditExportShown: { en: 'Export shown events', ja: '表示中のイベントをエクスポート' },
  auditExportTooltip: {
    en: 'Download the {count} loaded events across all table pages. Narrow the filters to export a different set.',
    ja: '読み込み済みの{count}件のイベントを、すべてのテーブルページ分ダウンロードします。別のイベントをエクスポートするには、フィルターを絞り込んでください。',
  },
  auditExportFailed: { en: 'Export failed', ja: 'エクスポートに失敗しました' },
  auditLoadingEvents: { en: 'Loading audit events...', ja: '監査イベントを読み込み中…' },
  auditNoEvents: {
    en: 'No audit events matched the current scope and filters.',
    ja: '現在のスコープとフィルターに一致する監査イベントはありません。',
  },
  auditColumnUser: { en: 'User', ja: 'ユーザー' },
  auditColumnScope: { en: 'Scope', ja: 'スコープ' },
  auditColumnOutcome: { en: 'Outcome', ja: '結果' },
  auditScopeProject: { en: 'Project:', ja: 'プロジェクト:' },
  auditScopeEnvironment: { en: 'Env:', ja: '環境:' },
  auditScopeOrganization: { en: 'Organization', ja: '組織' },
  auditProjectIdCopied: { en: 'Project ID copied.', ja: 'プロジェクトIDをコピーしました。' },
  auditEnvironmentIdCopied: { en: 'Environment ID copied.', ja: '環境IDをコピーしました。' },
  auditProjectIdCopyFailed: {
    en: 'Clipboard copy failed. Copy project ID manually.',
    ja: 'クリップボードへのコピーに失敗しました。プロジェクトIDを手動でコピーしてください。',
  },
  auditEnvironmentIdCopyFailed: {
    en: 'Clipboard copy failed. Copy environment ID manually.',
    ja: 'クリップボードへのコピーに失敗しました。環境IDを手動でコピーしてください。',
  },

  // Event detail labels
  auditDetailEventId: { en: 'Event ID', ja: 'イベントID' },
  auditDetailAction: { en: 'Action', ja: 'アクション' },
  auditDetailActor: { en: 'Actor', ja: '実行者' },
  auditDetailActorId: { en: 'Actor ID', ja: '実行者ID' },
  auditDetailActorType: { en: 'Actor Type', ja: '実行者タイプ' },
  auditDetailPolicy: { en: 'Policy', ja: 'ポリシー' },
  auditDetailApproval: { en: 'Approval', ja: '承認' },
  auditDetailPurchase: { en: 'Purchase', ja: '購入' },
  auditDetailAdjustment: { en: 'Adjustment', ja: '調整' },
  auditDetailInvoice: { en: 'Invoice', ja: '請求書' },
  auditDetailReasonCode: { en: 'Reason Code', ja: '理由コード' },
  auditDetailResultingBalance: { en: 'Resulting Balance', ja: '調整後の残高' },
  auditDetailNote: { en: 'Note', ja: 'メモ' },
  auditDetailOrganization: { en: 'Organization', ja: '組織' },
  auditDetailReceipt: { en: 'Receipt', ja: '領収書' },
  auditDetailWebhookEndpoint: { en: 'Webhook Endpoint', ja: 'Webhookエンドポイント' },
  auditDetailWebhookDelivery: { en: 'Webhook Delivery', ja: 'Webhook配信' },
  auditDetailScopeType: { en: 'Scope Type', ja: 'スコープタイプ' },
  auditDetailScopeId: { en: 'Scope ID', ja: 'スコープID' },
  auditDetailProject: { en: 'Project', ja: 'プロジェクト' },
  auditDetailEnvironment: { en: 'Environment', ja: '環境' },
  auditDetailRawJson: { en: 'Raw JSON', ja: 'JSON（生データ）' },
  auditDetailBalance: { en: 'Balance {amount}', ja: '残高 {amount}' },

  // Event titles
  auditPolicyKindGasSponsorship: { en: 'Gas sponsorship', ja: 'ガス代スポンサー' },
  auditPolicyKindTransaction: { en: 'Transaction', ja: 'トランザクション' },
  auditScopeTypeProject: { en: 'Project', ja: 'プロジェクト' },
  auditScopeTypeEnvironment: { en: 'Environment', ja: '環境' },
  auditScopeTypeOrganization: { en: 'Organization', ja: '組織' },
  auditTitleApprovalCreated: { en: 'Created approval request', ja: '承認リクエストを作成しました' },
  auditTitleApprovalApproved: {
    en: 'Approved approval request',
    ja: '承認リクエストを承認しました',
  },
  auditTitleApprovalRejected: {
    en: 'Rejected approval request',
    ja: '承認リクエストを却下しました',
  },
  auditTitleApprovalUpdated: { en: 'Updated approval request', ja: '承認リクエストを更新しました' },
  auditTitlePolicyCreated: { en: 'Created policy', ja: 'ポリシーを作成しました' },
  auditTitlePolicyUpdated: { en: 'Updated policy', ja: 'ポリシーを更新しました' },
  auditTitlePolicyDeleted: { en: 'Deleted policy', ja: 'ポリシーを削除しました' },
  auditTitlePolicyPublished: { en: 'Published policy', ja: 'ポリシーを公開しました' },
  auditTitlePolicyAssignmentUpdated: {
    en: 'Updated policy assignment',
    ja: 'ポリシーの割り当てを更新しました',
  },
  auditTitlePolicyAssignmentRemoved: {
    en: 'Removed policy assignment',
    ja: 'ポリシーの割り当てを解除しました',
  },
  auditTitleCreditPurchaseSettled: {
    en: 'Settled Stripe credit purchase',
    ja: 'Stripeでのクレジット購入が決済されました',
  },
  auditTitleInvoiceGenerated: { en: 'Generated invoice', ja: '請求書を生成しました' },
  auditTitleInvoiceRefreshed: { en: 'Refreshed invoice', ja: '請求書を更新しました' },
  auditTitleInvoicePdfExported: {
    en: 'Exported invoice PDF',
    ja: '請求書のPDFをエクスポートしました',
  },
  auditTitleSupportCreditReusedCustomer: {
    en: 'Reused customer support credit',
    ja: '顧客のサポートクレジットを再利用しました',
  },
  auditTitleSupportCreditReused: {
    en: 'Reused support credit',
    ja: 'サポートクレジットを再利用しました',
  },
  auditTitleSupportCreditGrantedCustomer: {
    en: 'Granted customer support credit',
    ja: '顧客にサポートクレジットを付与しました',
  },
  auditTitleSupportCreditGranted: {
    en: 'Granted support credit',
    ja: 'サポートクレジットを付与しました',
  },
  auditTitleAdminDebitReusedCustomer: {
    en: 'Reused customer admin debit',
    ja: '顧客への管理者による引き落としを再利用しました',
  },
  auditTitleAdminDebitReused: {
    en: 'Reused admin debit',
    ja: '管理者による引き落としを再利用しました',
  },
  auditTitleAdminDebitAppliedCustomer: {
    en: 'Applied customer admin debit',
    ja: '顧客に管理者による引き落としを適用しました',
  },
  auditTitleAdminDebitApplied: {
    en: 'Applied admin debit',
    ja: '管理者による引き落としを適用しました',
  },
  auditTitleWebhookEndpointCreated: {
    en: 'Created webhook endpoint',
    ja: 'Webhookエンドポイントを作成しました',
  },
  auditTitleWebhookEndpointUpdated: {
    en: 'Updated webhook endpoint',
    ja: 'Webhookエンドポイントを更新しました',
  },
  auditTitleWebhookEndpointDeleted: {
    en: 'Deleted webhook endpoint',
    ja: 'Webhookエンドポイントを削除しました',
  },
  auditTitleWebhookReplayRequested: {
    en: 'Requested webhook replay',
    ja: 'Webhookの再送信をリクエストしました',
  },

  // Observability
  observabilityPageLabel: { en: 'Observability page', ja: 'オブザーバビリティページ' },
  observabilityRefreshing: {
    en: 'Refreshing observability...',
    ja: 'オブザーバビリティを更新中…',
  },
  observabilityWarningsLabel: {
    en: 'Observability status warnings',
    ja: 'オブザーバビリティのステータス警告',
  },
  observabilityOverviewLabel: { en: 'Observability overview', ja: 'オブザーバビリティの概要' },
  observabilityOverviewHeading: { en: 'Overview', ja: '概要' },
  observabilityWindowLabel: {
    en: 'Time window for all observability data',
    ja: 'すべてのオブザーバビリティデータの期間',
  },
  observabilityWindowOption: { en: 'Window: {label}', ja: '期間: {label}' },
  observabilitySummaryLabel: {
    en: 'Observability summary metrics',
    ja: 'オブザーバビリティのサマリー指標',
  },
  observabilityErrorRate: { en: 'Error rate', ja: 'エラー率' },
  observabilityP95Latency: { en: 'p95 latency', ja: 'p95レイテンシ' },
  observabilityFailingServices: { en: 'Failing services', ja: '障害中のサービス' },
  observabilityDeadLetters: { en: 'Dead letters', ja: 'デッドレター' },
  observabilityServiceHealthTableLabel: {
    en: 'Observability service health table',
    ja: 'オブザーバビリティのサービス状態テーブル',
  },
  observabilityServiceHealth: { en: 'Service health', ja: 'サービスの状態' },
  observabilityServiceHealthLabel: {
    en: 'Observability service health',
    ja: 'オブザーバビリティのサービス状態',
  },
  observabilityServiceItemLabel: { en: 'service', ja: 'サービス' },
  observabilityServiceItemLabelPlural: { en: 'services', ja: 'サービス' },
  observabilityColumnService: { en: 'Service', ja: 'サービス' },
  observabilityColumnStatus: { en: 'Status', ja: 'ステータス' },
  observabilityColumnRecentFailures: { en: 'Recent failures', ja: '最近の障害' },
  observabilityColumnLatestIncident: { en: 'Latest incident', ja: '直近のインシデント' },
  observabilityColumnLevel: { en: 'Level', ja: 'レベル' },
  observabilityInvestigateFailures: {
    en: 'Investigate recent failures',
    ja: '最近の障害を確認してください',
  },
  observabilityNoRecentFailures: { en: 'No recent failures', ja: '最近の障害はありません' },
  observabilityLoadingServices: {
    en: 'Loading service health...',
    ja: 'サービスの状態を読み込み中…',
  },
  observabilityNoServices: {
    en: 'No service health records for this scope.',
    ja: 'このスコープにはサービスの状態の記録がありません。',
  },
  observabilityStatusHealthy: { en: 'Healthy', ja: '正常' },
  observabilityStatusDegraded: { en: 'Degraded', ja: '低下' },
  observabilityStatusFailing: { en: 'Failing', ja: '障害' },
  observabilityStatusUnknown: { en: 'Unknown', ja: '不明' },
  observabilityEventsTableLabel: {
    en: 'Observability events table',
    ja: 'オブザーバビリティのイベントテーブル',
  },
  observabilityEventLog: { en: 'Event log', ja: 'イベントログ' },
  observabilityEventControlsLabel: {
    en: 'Observability event controls',
    ja: 'オブザーバビリティのイベント操作',
  },
  observabilityEventFiltersLabel: {
    en: 'Observability event filters',
    ja: 'オブザーバビリティのイベントフィルター',
  },
  observabilitySearchEvents: {
    en: 'Search observability events',
    ja: 'オブザーバビリティのイベントを検索',
  },
  observabilitySearchPlaceholder: {
    en: 'Search event ID, message, request, trace, or metadata',
    ja: 'イベントID、メッセージ、リクエスト、トレース、メタデータで検索',
  },
  observabilityFilterByLevel: {
    en: 'Filter observability events by level',
    ja: 'オブザーバビリティのイベントをレベルで絞り込み',
  },
  observabilityLevelOption: { en: 'Level: {level}', ja: 'レベル: {level}' },
  observabilityLevelDebug: { en: 'Debug', ja: 'デバッグ' },
  observabilityLevelInfo: { en: 'Info', ja: '情報' },
  observabilityLevelWarn: { en: 'Warn', ja: '警告' },
  observabilityLevelError: { en: 'Error', ja: 'エラー' },
  observabilityLevelFatal: { en: 'Fatal', ja: '致命的' },
  observabilityEventsLabel: { en: 'Observability events', ja: 'オブザーバビリティのイベント' },
  observabilityLoadingEvents: {
    en: 'Loading observability events...',
    ja: 'オブザーバビリティのイベントを読み込み中…',
  },
  observabilityNoEventsFiltered: {
    en: 'No observability incidents match the current filters.',
    ja: '現在のフィルターに一致するオブザーバビリティのインシデントはありません。',
  },
  observabilityNoEvents: {
    en: 'No incidents in the selected window. Observability is incident-driven, so healthy periods can be empty.',
    ja: '選択した期間にインシデントはありません。オブザーバビリティはインシデントを記録する仕組みのため、正常な期間は空になることがあります。',
  },
  observabilityDetailComponent: { en: 'Component', ja: 'コンポーネント' },
  observabilityDetailRequestId: { en: 'Request ID', ja: 'リクエストID' },
  observabilityDetailTraceId: { en: 'Trace ID', ja: 'トレースID' },
  observabilityDetailMetadata: { en: 'Metadata', ja: 'メタデータ' },
  observabilityMetadataMore: { en: ', +{count} more', ja: '、ほか{count}件' },
  observabilityLoadingMore: { en: 'Loading more events...', ja: 'イベントを読み込み中…' },
  observabilityLoadMore: { en: 'Load more events', ja: 'さらにイベントを読み込む' },
  observabilityModuleSummary: { en: 'Summary', ja: 'サマリー' },
  observabilityModuleEvents: { en: 'Events', ja: 'イベント' },
  observabilityWarningNotConfigured: {
    en: '{label} is not configured{detail}',
    ja: '{label}は構成されていません{detail}',
  },
  observabilityWarningForbidden: {
    en: '{label} is not available for this role{detail}',
    ja: '{label}はこのロールでは利用できません{detail}',
  },
  observabilityWarningDegraded: {
    en: '{label} is degraded{detail}',
    ja: '{label}の動作が低下しています{detail}',
  },
  observabilityErrorNotConfigured: {
    en: 'Observability service is not configured on this server.',
    ja: 'このサーバーではオブザーバビリティサービスが構成されていません。',
  },
  observabilityErrorForbidden: {
    en: 'Observability is not available for this role.',
    ja: 'オブザーバビリティはこのロールでは利用できません。',
  },

  // Overview (ops cockpit)
  overviewPageLabel: { en: 'Ops cockpit page', ja: '運用コックピットページ' },
  overviewQuickActionsLabel: { en: 'Quick actions', ja: 'クイックアクション' },
  overviewApiKeysTitle: { en: 'API keys', ja: 'APIキー' },
  overviewApiKeysDescription: {
    en: 'Manage credentials for this environment.',
    ja: 'この環境の認証情報を管理します。',
  },
  overviewCredits: { en: 'Credits', ja: 'クレジット' },
  overviewAddCredits: { en: 'Add credits', ja: 'クレジットを追加' },
  overviewPendingApprovalsLabel: { en: 'Pending approvals summary', ja: '保留中の承認のサマリー' },
  overviewPendingApprovals: { en: 'Pending approvals', ja: '保留中の承認' },
  overviewNoPendingApprovals: { en: 'No pending approvals.', ja: '保留中の承認はありません。' },
  overviewApprovalLine: {
    en: '{operation} for {resource} {resourceId} by {user} at {time}',
    ja: '{operation}（対象: {resource} {resourceId}、リクエスト者: {user}、日時: {time}）',
  },
  overviewApprovalKeyExport: { en: 'Key export', ja: '鍵のエクスポート' },
  overviewApprovalPolicyPublish: { en: 'Policy publish', ja: 'ポリシーの公開' },
  overviewApprovalDefault: { en: 'Approval', ja: '承認' },
  overviewApprovalResource: { en: 'Resource', ja: 'リソース' },
  overviewRequestedReason: { en: 'Requested reason: {reason}', ja: 'リクエストの理由: {reason}' },
  overviewApprovalsRequiredOne: { en: '1 approval required.', ja: '必要な承認数: 1' },
  overviewApprovalsRequiredMany: { en: '{count} approvals required.', ja: '必要な承認数: {count}' },
  overviewMfaRequiredToApprove: {
    en: 'MFA verification is required to approve.',
    ja: '承認には MFA認証が必要です。',
  },
  overviewApproveUnavailableMfa: {
    en: 'Approve unavailable in overview: this request requires MFA verification.',
    ja: '概要画面では承認できません。このリクエストには MFA認証が必要です。',
  },
  overviewApprove: { en: 'Approve', ja: '承認' },
  overviewApproving: { en: 'Approving...', ja: '承認中…' },
  overviewReject: { en: 'Reject', ja: '却下' },
  overviewRejecting: { en: 'Rejecting...', ja: '却下中…' },
  overviewApprovalIdRequired: { en: 'Approval id is required.', ja: '承認IDが必要です。' },
  overviewApprovalActionsUnavailable: {
    en: 'Approval actions are unavailable.',
    ja: '承認操作を利用できません。',
  },
  overviewApprovalNowStatus: {
    en: 'Approval request {id} is now {status}.',
    ja: '承認リクエスト {id} のステータスは {status} になりました。',
  },
  overviewBillingSummaryLabel: { en: 'Billing failure summary', ja: '請求失敗のサマリー' },
  overviewFailedInvoices: { en: 'Failed or overdue invoices', ja: '失敗または期限超過の請求書' },
  overviewNoFailedInvoices: {
    en: 'No failed or overdue invoices.',
    ja: '失敗または期限超過の請求書はありません。',
  },
  overviewInvoiceLine: {
    en: 'Invoice {id} is {status} with due date {date}.',
    ja: '請求書 {id} のステータスは {status}、支払期限は {date} です。',
  },
  overviewWebhookSummaryLabel: { en: 'Failed webhook summary', ja: '失敗したWebhookのサマリー' },
  overviewFailedWebhooks: {
    en: 'Failed webhooks (dead letters)',
    ja: '失敗したWebhook（デッドレター）',
  },
  overviewNoDeadLetters: {
    en: 'No unresolved webhook dead letters.',
    ja: '未解決のWebhookデッドレターはありません。',
  },
  overviewDeadLetterLine: {
    en: 'Endpoint {endpoint} event {event} failed {attempts} attempts; last error: {error} ({time})',
    ja: 'エンドポイント {endpoint}、イベント {event} が {attempts} 回失敗しました。最後のエラー: {error}（{time}）',
  },
  overviewNotAvailable: { en: 'n/a', ja: 'なし' },
  overviewReplay: { en: 'Replay', ja: '再送信' },
  overviewReplaying: { en: 'Replaying...', ja: '再送信中…' },
  overviewReplayUnavailable: {
    en: 'Replay unavailable: delivery id is missing for this dead letter.',
    ja: '再送信できません。このデッドレターには配信IDがありません。',
  },
  overviewReplayQueued: {
    en: 'Replay queued for delivery {id}.',
    ja: '配信 {id} の再送信をキューに追加しました。',
  },
  overviewSummaryLabel: { en: 'Ops cockpit summary', ja: '運用コックピットのサマリー' },
  overviewRefreshingQueues: {
    en: 'Refreshing queue snapshot...',
    ja: 'キューのスナップショットを更新中…',
  },
  overviewQueueApprovals: { en: 'Approvals queue', ja: '承認キュー' },
  overviewQueueBillingFailures: { en: 'Billing failure queue', ja: '請求失敗キュー' },
  overviewQueueWebhookDeadLetters: { en: 'Webhook dead letters', ja: 'Webhookデッドレター' },
  overviewWarningForbidden: {
    en: '{label} is not available for this role{detail}',
    ja: '{label}はこのロールでは利用できません{detail}',
  },
  overviewWarningFailed: { en: '{label} failed{detail}', ja: '{label}に失敗しました{detail}' },
  overviewWebhookScanCapped: {
    en: 'Webhook dead-letter scan capped at {scanned} endpoints (total {total}).',
    ja: 'Webhookデッドレターのスキャンは {scanned} エンドポイントまでに制限されています（合計 {total}）。',
  },
} as const satisfies Record<string, Entry>;
