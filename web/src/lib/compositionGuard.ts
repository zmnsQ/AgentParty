/** IME confirmation keys are text input, never a send/close command. */
export function isCompositionKey(event:{isComposing?:boolean;keyCode?:number;nativeEvent?:{isComposing?:boolean;keyCode?:number}}):boolean {
 return event.isComposing===true||event.keyCode===229||event.nativeEvent?.isComposing===true||event.nativeEvent?.keyCode===229;
}
