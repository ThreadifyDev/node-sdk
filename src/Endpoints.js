// Shared address parsing for Node and browser transports.
export function connectionEndpoints(options) {
  if (options.engineUrl !== undefined) {
    if (options.url !== undefined || options.wsUrl !== undefined || options.graphqlUrl !== undefined) {
      throw new Error('Use engineUrl on its own, without url, wsUrl or graphqlUrl');
    }
    if (typeof options.engineUrl !== 'string' || !options.engineUrl.trim()) throw new Error('engineUrl must be an absolute HTTP or HTTPS URL');
    let base;
    try { base = new URL(options.engineUrl.trim()); }
    catch { throw new Error('engineUrl must be an absolute HTTP or HTTPS URL'); }
    if (!['http:', 'https:'].includes(base.protocol) || !base.hostname || base.username || base.password || base.search || base.hash || /[?#]/.test(options.engineUrl)) {
      throw new Error('engineUrl must use HTTP or HTTPS without credentials, a query or a fragment');
    }
    const address = base.href.replace(/\/+$/, '');
    const socket = new URL(address + '/threads');
    socket.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    return { wsUrl: socket.href, graphqlUrl: address + '/graphql' };
  }
  const wsUrl = options.wsUrl || options.url || 'wss://eng.threadify.dev/threads';
  return { wsUrl, graphqlUrl: options.graphqlUrl || wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/threads\/?$/, '/graphql') };
}
