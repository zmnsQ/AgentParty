/** Inject a deterministic handoff after the external fixture operation, before
 * its response reaches the adapter. Only the network boundary is replaced;
 * injected competing lease/terminal writes use the actual test D1 database.
 */
export function interceptFetchResponse(
  matches: (url: URL, method: string) => boolean,
  afterResponse: (response: Response) => Promise<Response>,
) {
  const previous = globalThis.fetch;
  let used = false;
  const wrapped: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const matched = !used && matches(new URL(request.url), request.method);
    if (matched) used = true;
    // Forward the constructed Request: construction can transfer a POST body.
    const response = await previous(request);
    return matched ? afterResponse(response) : response;
  };
  globalThis.fetch = wrapped;
  return {
    restore: () => { if (globalThis.fetch === wrapped) globalThis.fetch = previous; },
  };
}
