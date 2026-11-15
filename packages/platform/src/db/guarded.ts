/** Driver errors embed query parameters (ids, addresses, tokens): only the operation's name may leave here. */
export async function guarded<T>(operation: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw new Error(operation);
  }
}
