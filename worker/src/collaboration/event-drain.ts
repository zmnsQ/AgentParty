import type {Hono} from 'hono';
import type {AppContext} from '../index';
import {sha256Hex} from '../auth';
import {hasPinnedCallbackTransport} from './event-transport';
import {deliverMcpEvents} from './mcp-events';
/** Maintenance only: re-deliver already queued signed events. No source-message
 * polling and no ability to create OAuth grants, subscriptions or user tasks. */
export function registerEventDrain(app:Hono<AppContext>):void {
 app.post('/internal/mcp-events/drain',async c=>{
  const supplied=c.req.header('x-agentcommons-egress-token')??'';
  if(!hasPinnedCallbackTransport(c.env)||!/^[a-f0-9]{64}$/.test(supplied))return c.json({error:'unauthorized'},401);
  const [a,b]=await Promise.all([sha256Hex(supplied),sha256Hex(c.env.COLLABORATION_EVENTS_EGRESS_TOKEN!)]);
  let delta=0;for(let i=0;i<a.length;i++)delta|=a.charCodeAt(i)^b.charCodeAt(i);
  if(delta!==0)return c.json({error:'unauthorized'},401);
  if(c.req.header('origin')||c.req.header('sec-fetch-site'))return c.json({error:'server_only'},403);
  const now=Date.now();
  const groups=await c.env.DB.prepare(`SELECT channel_slug,MIN(created_at) AS oldest FROM mcp_event_outbox
    WHERE state='pending' AND next_attempt_at<=? AND lease_until<=?
    GROUP BY channel_slug ORDER BY oldest LIMIT 2`).bind(now,now).all<{channel_slug:string}>();
  const results=await Promise.all(groups.results.map(g=>deliverMcpEvents(c.env,g.channel_slug,2)));
  return c.json({attempted:results.reduce((sum,x)=>sum+x.attempted,0),delivered:results.reduce((sum,x)=>sum+x.delivered,0)});
 });
}
