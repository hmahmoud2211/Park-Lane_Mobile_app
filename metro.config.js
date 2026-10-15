// Learn more https://docs.expo.dev/guides/customizing-metro
const http = require('http');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * The eWeLink CUBE hub sends no CORS headers, so in the browser the app calls
 * it as `/cube/...` on the dev server, and this forwards the request to the
 * hub (src/constants/cubeConfig.ts). Native builds call the hub directly.
 */
const CUBE_PREFIX = '/cube/';
const cubeUrl = new URL(process.env.EXPO_PUBLIC_CUBE_URL || 'http://192.168.1.119');

function proxyToCube(req, res) {
  const upstream = http.request(
    {
      hostname: cubeUrl.hostname,
      port: cubeUrl.port || 80,
      method: req.method,
      path: req.url.slice(CUBE_PREFIX.length - 1),
      headers: { ...req.headers, host: cubeUrl.host },
    },
    (hubResponse) => {
      res.writeHead(hubResponse.statusCode || 502, hubResponse.headers);
      hubResponse.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 502, data: {}, message: 'smart home hub unreachable' }));
  });
  req.pipe(upstream);
}

const enhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const next = enhanceMiddleware ? enhanceMiddleware(middleware, server) : middleware;
  return (req, res, fallthrough) =>
    req.url && req.url.startsWith(CUBE_PREFIX)
      ? proxyToCube(req, res)
      : next(req, res, fallthrough);
};

module.exports = config;
