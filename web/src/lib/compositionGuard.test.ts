// @ts-expect-error Bun test API is not part of the browser tsconfig.
import {describe,expect,test} from "bun:test";
import {isCompositionKey} from "./compositionGuard";
describe("IME candidate confirmation must not become a command",()=>{
 test("recognizes native and React composition flags and legacy 229",()=>{for(const event of [{isComposing:true},{keyCode:229},{nativeEvent:{isComposing:true}},{nativeEvent:{keyCode:229}}])expect(isCompositionKey(event)).toBe(true);});
 test("ordinary keys remain available",()=>{expect(isCompositionKey({})).toBe(false);expect(isCompositionKey({nativeEvent:{isComposing:false,keyCode:13}})).toBe(false);});
});
