export const MAX_NODE_ATTEMPTS: number
export function shouldRetryExecution (o: { isTransaction: boolean; message: string; attempt: number; stopped?: boolean }): boolean
export function retryDelayMs (attempt: number): number
