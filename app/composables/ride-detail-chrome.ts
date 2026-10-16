/**
 * The phone Ride detail covers the shell's bottom bar with its own action bar.
 * Transfers sets this. The frame only reads it. ADR-0038.
 */
export function useRideDetailChrome() {
  const phoneDetailOpen = useState('ride-detail-phone', () => false)
  return { phoneDetailOpen }
}
