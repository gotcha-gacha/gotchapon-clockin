// Geo-block (F5.3; CLAUDE.md decisions, BUILD_PLAN B4.1): the countries closed at launch, and how the block screen names them.
// The server blocks by IP at the edge and answers GEO_BLOCKED; this list also lets the app close itself on /me.country. ISO 3166
// says GB for the United Kingdom; UK is accepted too in case a server sends it.
const CLOSED: Record<string, string> = {
  US: 'the United States', GB: 'the United Kingdom', UK: 'the United Kingdom', CN: 'China', BE: 'Belgium', NL: 'the Netherlands', JP: 'Japan',
};
const norm = (country: string) => country.trim().toUpperCase();

export const isBlockedCountry = (country: string | null | undefined): boolean => !!country && CLOSED[norm(country)] !== undefined;

/** How the block screen names a country: "Japan", "the Netherlands", or "your country" when it is not one we list. */
export const countryName = (country: string | null | undefined): string => (country && CLOSED[norm(country)]) || 'your country';

/** Close the app when the server says so (GEO_BLOCKED on a read) or /me names a closed country. */
export const geoBlocked = (country: string | null | undefined, errorCode: string | null | undefined): boolean =>
  errorCode === 'GEO_BLOCKED' || isBlockedCountry(country);
