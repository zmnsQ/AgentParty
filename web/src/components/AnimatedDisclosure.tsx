import {useId, type ReactNode} from "react";
/** Intrinsic-height animation keeps content mounted; inert removes hidden controls
 * from keyboard and accessibility navigation without losing a draft. */
export function AnimatedDisclosure({open, id, className = "", children}: {open:boolean;id?:string;className?:string;children:ReactNode}) {
  const generatedId = useId();
  return <div id={id ?? generatedId} className={`animated-disclosure ${className}`} data-open={open} inert={!open} aria-hidden={!open}>
    <div className="animated-disclosure-body">{children}</div>
  </div>;
}
