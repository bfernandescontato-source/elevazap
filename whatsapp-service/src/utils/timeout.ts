export class OperationTimeoutError extends Error {
  readonly code = "OPERATION_TIMEOUT";

  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
    options?: { cause?: unknown }
  ) {
    super(`${operation} excedeu o limite de ${timeoutMs} ms.`, options);
    this.name = "OperationTimeoutError";
  }
}

export async function withTimeout<T>(
  operation: string,
  timeoutMs: number,
  work: PromiseLike<T> | ((signal: AbortSignal) => PromiseLike<T>),
  onTimeout?: () => void
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      try { onTimeout?.(); } catch {}
      reject(new OperationTimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });

  try {
    const promise = typeof work === "function" ? work(controller.signal) : work;
    return await Promise.race([Promise.resolve(promise), timeout]);
  } catch (error) {
    if (error instanceof OperationTimeoutError) throw error;
    if (controller.signal.aborted) throw new OperationTimeoutError(operation, timeoutMs, { cause: error });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
