/** The mobile and web products share one checked-in brand master. */
export function Brand({wordmark = true}: {wordmark?: boolean}) {
  return <span className="commons-brand"><img src="/brand/mark.png" width="36" height="36" alt="" />{wordmark && <span>AgentCommons</span>}</span>;
}
