export interface BatchRequestIdentity {
  version: number;
  batchId: string;
  projectId: string;
}

export function isCurrentBatchRequest(
  request: BatchRequestIdentity,
  latestVersion: number,
  selectedBatchId: string,
  selectedProjectId: string,
): boolean {
  return request.version === latestVersion
    && request.batchId === selectedBatchId
    && request.projectId === selectedProjectId;
}
