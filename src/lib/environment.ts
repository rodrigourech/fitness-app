/** A beta preview imports live data once and keeps every subsequent change on this device. */
export const isBetaSandbox = import.meta.env.VITE_BETA_SANDBOX === 'true'

export function requireLiveWrites(): void {
  if (isBetaSandbox) throw new Error('This action is unavailable in the local beta preview. Use the live app.')
}
