// Colour reports on their way to the view: a block's height has changed and the view has not been told yet.
// Its own module so the view can ask without loading the highlighter.

let waiting = 0;

export function reportQueued(): void {
  waiting += 1;
}

export function reportDelivered(): void {
  waiting -= 1;
}

/** Whether a block has changed height by colour and its report to the view is still waiting for the frame. */
export function colourReportsWaiting(): boolean {
  return waiting > 0;
}
