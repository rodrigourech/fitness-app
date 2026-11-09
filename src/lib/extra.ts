// Extra exercise (decision 5 November 2026, revised 9 November): the slot comment «Extra …» marks an exercise that is
// only done with enough time and energy. A workout starts it as skipped; Rodrigo adds it by hand.

export function isExtra(comment: string | null | undefined): boolean {
  return /^extra\b/i.test(comment?.trim() ?? '')
}
