import {type ReactNode} from "react";
import {createPortal} from "react-dom";

/** Dialogs must not inherit a toolbar's clipping/stacking context.
 * SSR and non-DOM component tests keep the same child tree. */
export function ModalPortal({children}:{children:ReactNode}) {
 const host=typeof document!=="undefined"&&document.body?.nodeType===1?document.body:null;
 return host?createPortal(children,host):<>{children}</>;
}
