/**
 * 流式 text 变更时，计算打字机应保留的游标，避免「追加」被当成重启导致前进后退。
 */
export function resolveTypewriterAdvanceIndex(
  previousText: string,
  nextText: string,
  currentIndex: number,
): number {
  const safeIndex = Math.max(0, Math.floor(currentIndex))
  if (nextText.length === 0) return 0
  if (previousText.length === 0) return Math.min(safeIndex, nextText.length)
  if (nextText.startsWith(previousText) || previousText.startsWith(nextText)) {
    return Math.min(safeIndex, nextText.length)
  }
  let common = 0
  const limit = Math.min(previousText.length, nextText.length)
  while (common < limit && previousText.charAt(common) === nextText.charAt(common)) {
    common += 1
  }
  return Math.min(safeIndex, common, nextText.length)
}
