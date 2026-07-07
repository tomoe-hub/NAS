/**
 * SEO分析ダッシュボードのデータ型。
 * NIS（DynamoDB版）の行スキーマを踏襲しつつ、単一サイト運用のため projectId を除去。
 * sk は S3 JSON 内での重複排除（マージ）キーとして使う。
 */

/** GSC: query×page、デバイス×ページ、国別のいずれか */
export type GscRowType = 'query' | 'device' | 'country'

export interface GscDailyRow {
  sk: string
  date: string
  rowType?: GscRowType
  query?: string
  page?: string
  device?: string
  country?: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/**
 * GA4 行種別。
 * - "kpi": date 軸のみ。総KPI集計に使用（sessions の過大計上を防ぐ）
 * - "main": date×pagePath×sourceMedium。ページ別レポート用
 * - "channel": date×channelGroup×landingPage。チャネル別レポート用
 * - "deviceGeo": date×deviceCategory×country。デバイス・国別レポート用
 */
export type Ga4RowType = 'kpi' | 'main' | 'channel' | 'deviceGeo'

export interface Ga4DailyRow {
  sk: string
  date: string
  rowType?: Ga4RowType
  pagePath?: string
  sourceMedium?: string
  channelGroup?: string
  landingPage?: string
  deviceCategory?: string
  country?: string
  sessions: number
  activeUsers: number
  newUsers: number
  pageViews: number
  avgSessionDuration: number
  bounceRate: number
  conversions: number
  engagedSessions?: number
  engagementRate?: number
  userEngagementDuration?: number
}

/** Clarity: サイト全体、ページ別、参照元、ブラウザ/端末、国・地域 */
export type ClarityRowKind = 'summary' | 'page' | 'referrer' | 'device' | 'geo'

export interface ClarityDailyRow {
  sk: string
  /**
   * date はスナップショット取得日（同期実行日）。
   * Clarity の project-live-insights は過去 numOfDays 日間のライブ集計であり、
   * GA4/GSC のような日次確定データではない。
   */
  date: string
  /** 何日間のライブウィンドウのスナップショットか（通常 1〜3） */
  sourceWindowDays?: number
  rowKind?: ClarityRowKind
  url?: string
  referrer?: string
  clarityBrowser?: string
  clarityDevice?: string
  clarityOs?: string
  traffic: number
  engagementTime: number
  scrollDepth: number
  deadClickCount: number
  rageClickCount: number
  scriptErrorCount: number
  quickbackCount?: number
  excessiveScrollCount?: number
  totalPageviews?: number
  distinctUsers?: number
  pagesPerSession?: number
  botSessionCount?: number
}

export type SeoSourceStatus = 'ok' | 'skipped_missing_config' | 'failed'

export interface SeoSyncMeta {
  lastSyncAt?: string
  lastGa4SyncAt?: string
  lastGscSyncAt?: string
  lastClaritySyncAt?: string
  lastResult?: SeoSyncResult
}

export interface SeoSyncSourceResult {
  status: SeoSourceStatus
  count: number
  error?: string
}

export interface SeoSyncResult {
  syncedAt: string
  days: number
  ga4: SeoSyncSourceResult
  gsc: SeoSyncSourceResult
  clarity: SeoSyncSourceResult
}
