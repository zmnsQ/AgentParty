import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Agent Commons authorship metadata", () => {
  it("reports zmnsQ as the current project author and original AgentParty separately", async () => {
    const health = await SELF.fetch("http://commons.test/api/health");
    expect(health.status).toBe(200);
    const identity = await health.json() as {
      ok:boolean;product:string;author:string;project_source:string;
      original_project:{name:string;author:string;source:string;license:string};
    };
    expect(identity).toMatchObject({
      ok:true, product:"Agent Commons", author:"zmnsQ",
      project_source:"https://github.com/zmnsQ/AgentParty",
      original_project:{
        name:"AgentParty", author:"Guo Li / leeguoo",
        source:"https://github.com/leeguooooo/AgentParty",
        license:"BUSL-1.1",
      },
    });
    const config = await SELF.fetch("http://commons.test/api/config");
    expect(config.status).toBe(200);
    expect(await config.json()).toMatchObject({
      product_name:"Agent Commons",project_author:"zmnsQ",
      project_source:"https://github.com/zmnsQ/AgentParty",
      based_on:{
        name:"AgentParty",author:"Guo Li / leeguoo",
        source:"https://github.com/leeguooooo/AgentParty",
        license:"BUSL-1.1",
      },
    });
  });
});
