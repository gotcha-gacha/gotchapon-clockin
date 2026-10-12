// The browser floor (W0.3, #121): a plain "use a newer browser" card for a browser the app cannot run in. It is markup and an
// ES5 script placed in the document by +html.tsx, ahead of the app's bundle, because on such a browser the bundle is exactly
// what may not parse: nothing here can depend on React, on the fonts or on any modern syntax. Pure strings: +html.tsx runs in Node.
//
// Supported (plan §5 W0.3): the current and previous major Safari, Chrome, Edge and Firefox; iOS Safari 16.4+. The card's
// trigger is capability, not a version table that goes stale: it shows when something the app needs is missing.
//   ResizeObserver      react-native-web's onLayout: the albums grid, the binder sleeves and the pager have no size without it
//   CSS scroll snap     the three-page track
//   RegExp lookbehind   needs nothing itself: it is the marker for Safari 16.4 (older Safari throws a SyntaxError on it), the
//                       floor the ticket names. Chrome 62+, Firefox 78+ have it. Not observed on an old Safari here: from MDN.
import { PRODUCT_NAME } from '@/brand/name';
import { color } from '@/theme/tokens';

export const BROWSER_FLOOR_ID = 'browser-floor';

export const BROWSER_FLOOR_HTML =
  `<div id="${BROWSER_FLOOR_ID}" role="alert" style="display:none;position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;` +
  `background:${color.room};color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;` +
  `align-items:center;justify-content:center;padding:24px;box-sizing:border-box;text-align:center">` +
  `<div style="max-width:340px"><div style="font-size:22px;font-weight:800;margin-bottom:10px">${PRODUCT_NAME} needs a newer browser</div>` +
  `<div style="font-size:15px;line-height:22px;opacity:.78">Update Safari, Chrome, Edge or Firefox to the latest version, then open this page again. ` +
  `On iPhone and iPad that means iOS 16.4 or later.</div></div></div>`;

export const BROWSER_FLOOR_SCRIPT =
  `(function(){var ok=true;try{` +
  `if(typeof window.ResizeObserver!=='function')ok=false;` +
  `if(!(window.CSS&&window.CSS.supports&&window.CSS.supports('scroll-snap-type','x mandatory')))ok=false;` +
  `new window.RegExp('(?<=a)b');` +
  `}catch(e){ok=false}` +
  `if(!ok){var el=document.getElementById('${BROWSER_FLOOR_ID}');if(el){el.style.display='flex';document.documentElement.setAttribute('data-browser-floor','1');}}` +
  `})();`;
