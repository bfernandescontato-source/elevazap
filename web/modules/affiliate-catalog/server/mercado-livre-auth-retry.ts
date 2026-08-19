export async function withAuthRetry<T>(
  run: () => Promise<T>,
  hooks: { refresh: () => Promise<void>; markReauthRequired: () => Promise<void> }
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "MERCADO_LIVRE_AUTH") throw error;
    await hooks.refresh();
    try {
      return await run();
    } catch (retryError) {
      if (retryError instanceof Error && retryError.message === "MERCADO_LIVRE_AUTH") {
        await hooks.markReauthRequired();
        throw new Error("MERCADO_LIVRE_REAUTHORIZATION_REQUIRED");
      }
      throw retryError;
    }
  }
}
