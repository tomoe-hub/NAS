import { format, parseISO, subDays } from 'date-fns'

export type RangeKey = '7d' | '28d' | '90d'

export interface ResolvedWindow {
  start: string
  end: string
  prevStart: string
  prevEnd: string
  preset: RangeKey
}

export function rangeKeyOrDefault(raw: string | null | undefined): RangeKey {
  if (raw === '7d' || raw === '28d' || raw === '90d') return raw
  return '28d'
}

function daysInclusive(start: string, end: string): number {
  return Math.round((parseISO(end).getTime() - parseISO(start).getTime()) / 86_400_000) + 1
}

/** 直前期間の計算（同じ日数だけ前へ） */
export function computePreviousWindow(start: string, end: string): { prevStart: string; prevEnd: string } {
  const n = daysInclusive(start, end)
  const prevEnd = format(subDays(parseISO(start), 1), 'yyyy-MM-dd')
  const prevStart = format(subDays(parseISO(start), n), 'yyyy-MM-dd')
  return { prevStart, prevEnd }
}

/** プリセットから今期＋直前比較期間を算出 */
export function resolveWindow(preset: RangeKey): ResolvedWindow {
  const days = preset === '7d' ? 7 : preset === '28d' ? 28 : 90
  const end = format(new Date(), 'yyyy-MM-dd')
  const start = format(subDays(new Date(), days - 1), 'yyyy-MM-dd')
  const { prevStart, prevEnd } = computePreviousWindow(start, end)
  return { start, end, prevStart, prevEnd, preset }
}
