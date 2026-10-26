const https = require('https');
const http = require('http');

const config = require('./config');

/**
 * Calls the EMS backend's voice API with the customer's EMS access token.
 * Resolves `{ status, body }`; network failures and timeouts reject, so the
 * skill can say it could not confirm instead of claiming success.
 */
function postCommand(token, payload) {
  const url = new URL('/api/voice/command', config.EMS_API_URL);
  const body = JSON.stringify(payload);
  const client = url.protocol === 'http:' ? http : https;

  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'application/json',
        },
        timeout: config.REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch (error) {
            parsed = null;
          }
          resolve({ status: response.statusCode || 0, body: parsed });
        });
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end(body);
  });
}

module.exports = { postCommand };
