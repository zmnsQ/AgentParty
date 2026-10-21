import { describe, expect, it } from "bun:test";
import { exportIdentityData } from "../src/rest";
import { startRestMock } from "./rest-mock";

describe("identity export independent page cursors", () => {
  it("collects every receipt page without duplicating exhausted message/audit streams", async () => {
    const requests: URLSearchParams[] = [];
    const mock = startRestMock((request) => {
      if (!request.path.includes("/identity/")) return undefined;
      const query = new URLSearchParams(request.query);
      requests.push(query);
      const receiptAfter = Number(query.get("receipt_after"));
      const messageAfter = Number(query.get("message_after"));
      const auditAfter = Number(query.get("audit_after"));
      const first = receiptAfter === 0;
      return Response.json({ name: "bot", exported_at: 1,
        messages: messageAfter === 0 ? [{ seq: 1, body: "one message" }] : [],
        audit: auditAfter === 0 ? [{ target_seq: 1 }] : [], wake_deliveries: [],
        collaboration_receipts: [{ idempotency_key: first ? "cloud-run:first" : "cloud-run:second", message_seq: first ? 10 : 11 }],
        read_cursor: null, presence: [],
        next: { messages: null, audit: null, wake_deliveries: null, collaboration_receipts: first ? 10 : null },
      });
    });
    try {
      const data = await exportIdentityData(mock.url, "synthetic-token", "group", "bot");
      expect(requests).toHaveLength(2);
      expect(requests[1]!.get("message_after")).toBe(String(Number.MAX_SAFE_INTEGER));
      expect(requests[1]!.get("audit_after")).toBe(String(Number.MAX_SAFE_INTEGER));
      expect(requests[1]!.get("receipt_after")).toBe("10");
      expect(data.messages).toHaveLength(1); expect(data.audit).toHaveLength(1);
      expect(data.collaboration_receipts?.map((receipt) => receipt.message_seq)).toEqual([10, 11]);
      expect(data.next.collaboration_receipts).toBeNull();
    } finally { mock.stop(); }
  });

  it("does not restart older servers' exhausted collections", async () => {
    let calls = 0;
    const mock = startRestMock((request) => {
      if (!request.path.includes("/identity/")) return undefined;
      calls++;
      return Response.json({ name: "bot", exported_at: 1, messages: [{ seq: calls }],
        // Legacy responses can repeat unrelated collection data; the collector ignores it.
        audit: [{ target_seq: 1 }], wake_deliveries: [], read_cursor: null, presence: [],
        next: { messages: calls === 1 ? 1 : null, audit: null, wake_deliveries: null },
      });
    });
    try {
      const data = await exportIdentityData(mock.url, "synthetic-token", "group", "bot");
      expect(calls).toBe(2); expect(data.messages).toHaveLength(2); expect(data.audit).toHaveLength(1);
      expect(data.collaboration_receipts).toBeUndefined();
    } finally { mock.stop(); }
  });

  it("stops on non-advancing page cursors instead of looping or duplicating data", async () => {
    let calls = 0;
    const mock = startRestMock((request) => {
      if (!request.path.includes("/identity/")) return undefined;
      calls++;
      return Response.json({ name: "bot", exported_at: 1, messages: [], audit: [], wake_deliveries: [],
        read_cursor: null, presence: [], next: { messages: 0, audit: null, wake_deliveries: null } });
    });
    try {
      await expect(exportIdentityData(mock.url, "synthetic-token", "group", "bot")).rejects.toThrow("non-advancing");
      expect(calls).toBe(1);
    } finally { mock.stop(); }
  });
});
