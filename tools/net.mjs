// Node's global fetch ignores HTTPS_PROXY. On a proxied network that means
// every request fails or is refused while curl works fine, which is a
// confusing way to lose an afternoon. Wire the env proxy in explicitly.
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

const hasProxy = !!(process.env.HTTPS_PROXY || process.env.https_proxy
                 || process.env.HTTP_PROXY  || process.env.http_proxy);
if (hasProxy) setGlobalDispatcher(new EnvHttpProxyAgent());

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const proxied = hasProxy;
