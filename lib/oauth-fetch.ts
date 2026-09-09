import type { RequestInit } from "undici";
import { EnvHttpProxyAgent, fetch } from "undici";

let dispatcher: EnvHttpProxyAgent | undefined;

// Apply the launcher's HTTP(S)_PROXY / NO_PROXY only to OAuth provider traffic.
// Construct lazily so .env has been loaded before resolving proxy settings.
export function oauthFetch(url: string, options: RequestInit = {}) {
  dispatcher ||= new EnvHttpProxyAgent();
  return fetch(url, { ...options, dispatcher });
}
