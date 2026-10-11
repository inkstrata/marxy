// Giving the event loop back (D-15): a long job done in slices awaits this between them, so the frames,
// the scrolling and the keys of another pane run in the gaps. A task of its own through a message channel,
// not a timer: a timer nested a few deep waits at least four milliseconds, which at a slice every few
// milliseconds is most of the time. Where there is no channel (a test without a DOM) a timer stands in.

let channel: MessageChannel | null = null;
const waiting: (() => void)[] = [];

export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  if (channel === null) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => waiting.shift()?.();
  }
  return new Promise((resolve) => {
    waiting.push(resolve);
    channel!.port2.postMessage(null);
  });
}
