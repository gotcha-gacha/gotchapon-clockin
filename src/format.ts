// Money copy shared by the machine, the Pull page, the card sheet and the header: "$1", "$1.50", "$12.50" (whole dollars
// bare, anything else to the cent).
export const dollars = (usd: number): string => (usd % 1 ? `$${usd.toFixed(2)}` : `$${usd}`);

/** A balance or pull count that has not been read yet. Not a digit, so it cannot be read as an empty wallet. */
export const PENDING_COUNT = '…';

/** A wallet address shortened for display: "7xKp…KpRq". */
export const shortAddress = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** A calendar date for display: "11 Oct 2026". */
export const dayMonthYear = (iso: string): string => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
