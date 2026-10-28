// @ts-expect-error Bun test API
import {test,expect,mock,beforeEach,afterEach} from 'bun:test';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {LocaleProvider} from '../i18n/locale';
// @ts-expect-error independent real reducer, not a mocked copy
const actualPairing=await import('../lib/desktopPairing.ts?lifecycle-actual');
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const finishes:Array<ReturnType<typeof deferred<string>>>=[];
let creates=0;
mock.module('../lib/desktopPairing',()=>({...actualPairing,
 createDesktopPairingSecrets:async()=>({codeVerifier:'fixture',codeChallenge:'fixture',deviceSecret:'fixture',deviceChallenge:'fixture'}),
 createDesktopPairing:async()=>({pairing_id:`fixture-${++creates}`,device_code:'fixture',user_code:'ABCDE-FGHIJ',verification_uri:'https://pair.test/pair',verification_uri_complete:'https://pair.test/pair?code=fixture',interval:1,expires_in:60}),
 pollDesktopPairing:async(options:{onEvent:(e:unknown)=>void})=>{const approved={type:'approved',tokens:{access_token:'fixture',refresh_token:'fixture'}};options.onEvent(approved);return approved;},
}));
mock.module('../lib/desktopCredentials',()=>({desktopCredentialVaultForOrigin:()=>({}),finishDesktopPairing:()=>{const d=deferred<string>();finishes.push(d);return d.promise;}}));
mock.module('../lib/desktopRuntime',()=>({listenForDesktopPairLinks:async()=>()=>{},openDesktopVerificationUrl:async()=>true}));
mock.module('@tauri-apps/api/app',()=>({getVersion:async()=>'fixture'}));
mock.module('./ServerProfiles',()=>({ServerProfilePicker:()=>null}));
const {DesktopPairingGate,DesktopPairingGateView}=await import('./DesktopPairingGate');
let renderer:ReactTestRenderer|null=null;
const saved=new Map<string,PropertyDescriptor|undefined>();
beforeEach(()=>{
 finishes.length=0;creates=0;
 for(const [key,value] of Object.entries({IS_REACT_ACT_ENVIRONMENT:true,window:{setTimeout,clearTimeout},localStorage:{getItem:()=> 'en',setItem:()=>{}},navigator:{platform:'test'}})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});}
});
afterEach(async()=>{if(renderer)await act(async()=>renderer!.unmount());renderer=null;for(const [key,d] of saved){if(d)Object.defineProperty(globalThis,key,d);else Reflect.deleteProperty(globalThis,key);}saved.clear();});
async function mount(onAuthenticated:(token:string,origin:string)=>void|Promise<void>){
 await act(async()=>{renderer=create(<LocaleProvider><DesktopPairingGate profiles={[{id:'fixture',label:'Fixture',origin:'https://pair.test',kind:'custom'}]} selectedOrigin="https://pair.test" onSelectOrigin={()=>{}} onProfilesChanged={()=>{}} onAuthenticated={onAuthenticated}/></LocaleProvider>);});
}
const view=()=>renderer!.root.findByType(DesktopPairingGateView);
async function start(){await act(async()=>{view().props.onStart();});}
test('cancel during credential storage prevents late account activation',async()=>{
 const activated:string[]=[];await mount(token=>{activated.push(token);});await start();
 expect(finishes).toHaveLength(1);expect(view().props.state.phase).toBe('pending');
 await act(async()=>view().props.onCancel());
 await act(async()=>finishes[0]!.resolve('old-access'));
 expect(activated).toEqual([]);expect(view().props.state.phase).toBe('cancelled');
});
test('unmount during credential storage prevents late activation',async()=>{
 const activated:string[]=[];await mount(token=>{activated.push(token);});await start();
 await act(async()=>renderer!.unmount());renderer=null;
 await act(async()=>finishes[0]!.resolve('late-access'));expect(activated).toEqual([]);
});
test('old start completion cannot approve or overwrite a newer start',async()=>{
 const activated:string[]=[];await mount(token=>{activated.push(token);});await start();await start();
 expect(finishes).toHaveLength(2);
 await act(async()=>finishes[0]!.resolve('old-access'));expect(activated).toEqual([]);expect(view().props.state.phase).toBe('pending');
 await act(async()=>finishes[1]!.resolve('new-access'));expect(activated).toEqual(['new-access']);expect(view().props.state.phase).toBe('approved');
});
test('async activation rejection is surfaced and approval is withheld until completion',async()=>{
 const activation=deferred<void>();await mount(()=>activation.promise);await start();
 await act(async()=>finishes[0]!.resolve('access'));expect(view().props.state.phase).toBe('pending');
 await act(async()=>activation.reject(new Error('fixture activation failed')));
 expect(view().props.state.phase).toBe('error');expect(view().props.state.error).toBe('fixture activation failed');
});
test('an old storage rejection cannot replace newer pending UI with an error',async()=>{
 await mount(()=>{});await start();await start();
 await act(async()=>finishes[0]!.reject(new Error('old failure')));
 expect(view().props.state.phase).toBe('pending');expect(view().props.state.error).toBeNull();
 await act(async()=>finishes[1]!.resolve('current'));expect(view().props.state.phase).toBe('approved');
});
test('approval appears only after an asynchronous application commit resolves',async()=>{
 const activation=deferred<void>();await mount(()=>activation.promise);await start();
 await act(async()=>finishes[0]!.resolve('access'));expect(view().props.state.phase).toBe('pending');
 await act(async()=>activation.resolve());expect(view().props.state.phase).toBe('approved');
});
