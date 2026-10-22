/** Original small line icons; no third-party logos or proprietary brand assets. */
export type StudioIconName="group"|"agent"|"message"|"plus"|"search"|"arrow"|"files"|"check";
const paths:Record<StudioIconName,string>={
 group:"M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-1a2.5 2.5 0 1 0 0-5M2 20v-2a6 6 0 0 1 12 0v2m3-7a5 5 0 0 1 5 5v2",
 agent:"M12 3v3m-6 0h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2ZM8 11h.01M16 11h.01M8 16h8M2 11v4m20-4v4",
 message:"M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-6 4V5a1 1 0 0 1 1-1Zm3 5h10M7 13h7",
 plus:"M12 5v14M5 12h14",search:"M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5.5-2 5 5",
 arrow:"M4 12h16m-6-6 6 6-6 6",files:"M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 14h8M8 17h6",
 check:"m5 12 4 4L19 6"
};
export function StudioIcon({name,className=""}:{name:StudioIconName;className?:string}){return <svg className={`studio-icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]}/></svg>;}
