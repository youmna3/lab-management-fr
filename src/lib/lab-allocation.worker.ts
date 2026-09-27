/// <reference lib="webworker" />

import { runAllocation } from "./lab-allocation-runner/run";
import type { RunAllocationParams } from "./allocation-client";

self.onmessage = async (event: MessageEvent<Omit<RunAllocationParams, "onProgress">>) => {
  try {
    const output = await runAllocation({
      ...event.data,
      onProgress: (progress) => self.postMessage({ type: "progress", progress }),
    });
    self.postMessage({ type: "complete", output });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Allocation failed in worker.",
    });
  }
};

export {};
