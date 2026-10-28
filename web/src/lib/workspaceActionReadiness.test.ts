// @ts-expect-error Bun test API
import {test,expect} from 'bun:test';
import {workspaceActionReady} from './workspaceActionReadiness';
test('a member destination remains pending until its authoritative roster arrives',()=>{
 const action={panel:'team',agent:'helper'};
 expect(workspaceActionReady(action,{canConnect:true,members:new Set()})).toBe(false);
 expect(workspaceActionReady(action,{canConnect:true,members:new Set(['helper'])})).toBe(true);
});
test('connect remains pending while account permission is unresolved, without granting access',()=>{
 expect(workspaceActionReady({panel:'connect'},{canConnect:false,members:new Set()})).toBe(false);
 expect(workspaceActionReady({panel:'connect'},{canConnect:true,members:new Set()})).toBe(true);
 expect(workspaceActionReady({panel:'files'},{canConnect:false,members:new Set()})).toBe(true);
});
