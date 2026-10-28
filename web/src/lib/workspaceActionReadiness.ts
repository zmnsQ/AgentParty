/** A sidebar request is consumed only once its destination can actually open. */
export function workspaceActionReady(action:{panel:string;agent?:string},context:{canConnect:boolean;members:ReadonlySet<string>}):boolean {
 if(action.panel==='connect')return context.canConnect;
 return action.agent===undefined||context.members.has(action.agent);
}
