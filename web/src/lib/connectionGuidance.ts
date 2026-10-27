import {ForbiddenError} from "./api";
/** Explain failures without turning an unknown result into a failed/expired connection. */
export function connectionFailure(cause: unknown, zh: boolean): string {
  const code = cause instanceof ForbiddenError && cause.code ? cause.code : cause instanceof Error ? cause.message : "operation_failed";
  const messages: Record<string, [string, string]> = {
    owner_only: ["只有群主可以配置此连接。", "Only the group owner can configure this connection."],
    human_member_required: ["需要以本群人类成员身份操作。", "Use a human member account for this group."],
    trigger_origin_not_approved: ["此触发地址的来源尚未获服务器管理员批准。请先联系管理员，不要更换为猜测的地址。", "The server administrator has not approved this trigger origin. Contact them; do not guess another URL."],
    invalid_trigger_url: ["触发地址格式不符合要求，请核对平台提供的 HTTPS 地址。", "Check the HTTPS trigger address supplied by your platform."],
    invalid_signing_secret: ["签名密钥格式不符合要求，请核对原始密钥；不要在群聊中发送密钥。", "Check the original webhook signing secret. Do not post it in chat."],
    automation_not_configured: ["请先保存本群的 Automation 配置。保存后仍需单独提交任务。", "Save this group's Automation configuration first. A task still needs a separate submission."],
    active_delivery_conflict: ["已有投递未确认。请先检查平台结果，不要重复发送。", "A delivery is still unresolved. Check the provider before sending again."],
    request_id_conflict: ["此请求编号已用于其他内容。请先核对原任务结果。", "This request ID belongs to different content. Check the original task first."],
    prompt_required: ["请先填写要执行的任务。", "Enter the task you want to run."],
    "Session expired": ["当前 Agent Commons 登录已失效，请重新登录；这不代表外部 Agent 的授权已失效。", "Your Agent Commons session expired. Sign in again; this does not establish that the external agent authorization expired."],
    "Not allowed": ["当前账号没有此操作权限，请核对群成员角色。", "Your account lacks permission for this action. Check your group role."],
  };
  const known = messages[code];
  return known ? known[zh ? 0 : 1] : zh
    ? "未能确认操作结果。请刷新状态并检查平台记录，再决定是否重试；不要重复提交任务。"
    : "The result could not be confirmed. Refresh status and check the provider before retrying; do not submit duplicate tasks.";
}
export function automationDeliveryLabel(state: string, zh: boolean): string {
  const labels: Record<string, [string,string]> = {
    submitting: ["正在投递", "Submitting"], submitted: ["平台已接收，完成情况未核验", "Accepted by provider; completion unverified"],
    rejected: ["平台拒绝接收", "Rejected by provider"], unknown: ["结果不明，请先核对平台", "Unknown; check the provider first"],
  };
  return (labels[state] ?? ["结果不明，请先核对平台", "Unknown; check the provider first"])[zh ? 0 : 1] ?? "Unknown";
}
