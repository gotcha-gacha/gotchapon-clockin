// The app, at every page path (W2.1, #128; plan §4.4): `/`, `/pull`, `/binder`, `/binder/:albumId`, `/wallet`, `/wallet/deposit`,
// and the page beneath a sheet route (`/card/:cardId`, `/odds`). ONE route for all of them, so a swipe (`router.setParams`)
// never remounts the pager or the ritual; a `router.push` to a page path would mount a new Home (measured, W0.2c #137).
// On the web an address that is none of those draws the not-found page instead (W2.2, #129): src/screens/AppRoute.web.tsx.
// The screens live in src/screens: tests render them without a router.
export { default } from '@/screens/AppRoute';
