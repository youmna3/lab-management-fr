/**
 * Asynchronous utility to yield execution back to the browser event loop.
 * This prevents long-running synchronous loops (like solving hundreds of ILP models)
 * from blocking user interaction, freezing the UI, or triggering Chrome's "Page Unresponsive" dialog.
 */
export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setTimeout !== "undefined") {
      setTimeout(resolve, 0);
    } else {
      resolve();
    }
  });
}
