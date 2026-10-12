// No image share on the web until W4.4 (Ben, 17 Sept: `docs/WEB_BUILD_PLAN.md` §7.21, §7.24). The web's share is the served
// preview image, post-launch; until then the Share pill is not drawn here, and native keeps its image share.
//
// A seam and not a `Platform.OS` test in PullPage, because of what the import costs: react-native-view-shot's web build is
// html2canvas, 201 KB of the 2.95 MB entry chunk, fetched by every visitor for a button the web never shows (W3.5, #142).
// Its capture of the foil's CanvasKit surface was never measured either (§7.21).

/** Never called on the web: nothing offers Share while CAN_SHARE_CARD is false. */
export function captureRef(): Promise<string> {
  return Promise.reject(new Error('No image share on the web (plan §7.24).'));
}

export const CAN_SHARE_CARD = false;
