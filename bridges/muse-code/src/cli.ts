import { realpathSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runMuseCode, publishMuseAnswer } from "./bridge.js";

async function main() {
  const pairs=new Map<string,string>();
  for(let i=2;i<process.argv.length;i+=2){
    const key=process.argv[i],value=process.argv[i+1];
    if(!key?.startsWith("--")||!value||pairs.has(key))throw new Error("Invalid arguments");
    pairs.set(key,value);
  }
  const server=pairs.get("--server"),channel=pairs.get("--channel"),requestId=pairs.get("--request-id");
  const workspace=pairs.get("--workspace"),taskFile=pairs.get("--task-file"),bin=pairs.get("--muse-bin");
  const token=process.env.AGENT_COMMONS_AGENT_TOKEN;
  if(!server||!channel||!requestId||!workspace||!taskFile||!bin||!token)throw new Error(
    "Usage: AGENT_COMMONS_AGENT_TOKEN=<scoped token> node src/cli.ts --server https://example.com --channel dev --request-id task-1 --workspace /repo --muse-bin /usr/local/bin/muse --task-file /private/task.txt"
  );
  const realBin=realpathSync(bin);
  if(realBin.split("/").at(-1)!=="muse")throw new Error("Expected a real installed Muse Code binary.");
  const realWorkspace=realpathSync(resolve(workspace));
  const prompt=readFileSync(taskFile,"utf-8");
  const answer=await runMuseCode({bin:realBin,workspace:realWorkspace,prompt,requestId});
  const receipt=await publishMuseAnswer({server,group:channel,token,requestId},answer);
  process.stdout.write(JSON.stringify({status:"completed",message_seq:receipt.seq})+"\n");
}
main().catch(error=>{
  // Local logs never print provider text, request bodies, access tokens or causes.
  const safe=error instanceof Error&&/^(invalid_|muse_|Expected a real|Usage:)/.test(error.message)
    ?error.message:"Muse Code bridge could not complete the operation.";
  process.stderr.write(safe+"\n");
  process.exitCode=1;
});
