/** Whether the app's tab is in sight: not hidden behind another tab or window. Without a page, as in tests, it is. */
export const inSight = () => globalThis.document?.visibilityState !== 'hidden'
