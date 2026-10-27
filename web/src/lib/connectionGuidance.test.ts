// @ts-expect-error Bun test runner
import {expect,test} from "bun:test";
import {ForbiddenError} from "./api";
import {connectionFailure,automationDeliveryLabel} from "./connectionGuidance";
test("guidance does not conflate site login with provider OAuth",()=>{
 expect(connectionFailure(new Error("Session expired"),false)).toContain("does not establish");
 expect(connectionFailure(new Error("Session expired"),true)).toContain("不代表外部 Agent");
});
test("unknown errors do not expose arbitrary server text or encourage resubmission",()=>{
 expect(connectionFailure(new Error("secret=private"),false)).not.toContain("private");
 expect(connectionFailure(null,true)).toContain("不要重复");
 expect(connectionFailure(new Error("trigger_origin_not_approved"),false)).toContain("administrator");
});
test("delivery acceptance is not completed work",()=>{
 expect(automationDeliveryLabel("submitted",true)).toContain("未核验");
 expect(automationDeliveryLabel("unknown",false)).toContain("check");
 expect(automationDeliveryLabel("future_state",false)).toContain("Unknown");
});

test("403 provider code is not masked by generic permission message",()=>{expect(connectionFailure(new ForbiddenError("Not allowed","trigger_origin_not_approved"),false)).toContain("administrator");});
