// Phones: a page opened one level deeper (an article, an event, a model, a sub-page of 我的) slides in from
// the right over the page it came from, and the bar's back button slides it away again. Such links opt in
// with React Router's `viewTransition`; the router then wraps the page change in a view transition, and
// this marks on <html data-vt> which way it goes for app.css. App-controlled back slides it away on
// supporting browsers; browser back changes pages without the phone slide, and desktop changes at once.
import { useEffect, useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router";
import { isPhone } from "./screens";

let goingBack = false;

/** Called just before navigating back from the app's own controls (the bar's back button, a tab tapped deeper in). */
export function markBack() {
  goingBack = true;
}

/**
 * WebKit 26 can accept a native page transition but leave React's destination render pending when
 * history returns to a long list. Keep the same navigation, without the native snapshot animation, on
 * WebKit; Chromium retains the app-controlled slide.
 */
function useSafeViewTransitions() {
  useEffect(() => {
    const doc = document;
    const original = doc.startViewTransition;
    if (!original) return;
    const ua = navigator.userAgent;
    const webkit = /AppleWebKit/u.test(ua) && !/(?:Chrome|Chromium|Edg|OPR)\//u.test(ua);
    if (!webkit) return;
    // Hide the API rather than emulating it: React Router's ViewTransition state can itself retain
    // the old tree while the destination's streaming article resolves. Ordinary routing commits it.
    // `delete` only removes an own property; WebKit inherits the method from Document.prototype.
    doc.startViewTransition = undefined as unknown as Document["startViewTransition"];
    return () => { doc.startViewTransition = original; };
  }, []);
}

/** In the root: marks the direction of each page change while it is committed, before the transition animates. */
export function usePageTransition() {
  useSafeViewTransitions();
  const { key } = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => {
    document.documentElement.dataset.vt = !isPhone() ? "none" : goingBack ? "back" : type === "POP" ? "none" : "push";
    goingBack = false;
  }, [key]);
}
