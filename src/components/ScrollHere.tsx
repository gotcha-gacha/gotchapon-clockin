// A still, invisible box in the stage that the page scrolls to when it mounts: web only (ScrollHere.web.tsx). The apps' screens
// are as tall as the machine, so there is nothing to scroll to and this renders nothing.
export type ScrollHereProps = { top: number; height: number; testID?: string };

export function ScrollHere(_props: ScrollHereProps) { return null; }
