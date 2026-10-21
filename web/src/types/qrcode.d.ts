declare module 'qrcode' {
  const qrcode: { toDataURL(text: string, options?: { width?: number; margin?: number; errorCorrectionLevel?: string }): Promise<string> };
  export default qrcode;
}
