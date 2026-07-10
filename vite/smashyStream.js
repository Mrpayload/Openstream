// Shared SmashyStream helpers used by both the Vite dev middleware
// (`vite/smplstream-plugin.js`) and the Vercel serverless function
// (`api/smplstream/embed.js`). Keeping the obfuscated base64 parts and the
// decoder in one place prevents the two implementations from drifting.
//
// `atob` is a global in Node 16+ (and in the browser), so a single
// implementation works in both runtimes without pulling in `Buffer`.

const SMASHY_B64_PARTS = [
  "U0ZML2RVN0IvRGx4",
  "MGNhL0JWb0kvTlM5",
  "Ym94LzJTSS9aU0Zj",
  "SGJ0L1dGakIvN0dX",
  "eE52L1QwOC96N0Yz"
];

export const decodeSmashyStream = (encoded) => {
  if (!encoded || typeof encoded !== "string") return null;
  try {
    // Remove the first 2 characters (version/type prefix)
    let formattedB64 = encoded.slice(2);
    // Remove obfuscated path segments in reverse order
    for (let i = SMASHY_B64_PARTS.length - 1; i >= 0; i--) {
      formattedB64 = formattedB64.replace(`//${SMASHY_B64_PARTS[i]}`, "");
    }
    return atob(formattedB64);
  } catch {
    return null;
  }
};
