// An app's slash command (/deploy). The Workspace POSTs the command to the
// `url` in the app's manifest, signed with the app's signing secret, and
// shows the answer (apps/workspace/INTEGRATIONS.md §4). Answer within 10 s;
// later answers go to `response_url`.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const SECRET = process.env.APP_SIGNING_SECRET!;

// `X-Workspace-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`
// (INTEGRATIONS.md §0); refuse a `t` more than five minutes old.
function verified(body: string, header: string | undefined) {
  const parts = Object.fromEntries(
    (header ?? '').split(',').map((p) => p.split('=') as [string, string]),
  );
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const want = createHmac('sha256', SECRET).update(`${parts.t}.${body}`).digest('hex');
  return (
    want.length === parts.v1.length && timingSafeEqual(Buffer.from(want), Buffer.from(parts.v1))
  );
}

createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!verified(body, req.headers['x-workspace-signature'] as string | undefined)) {
    res.statusCode = 401;
    res.end();
    return;
  }
  const cmd = JSON.parse(body) as {
    command: string;
    text: string;
    member: { display_name: string };
  };
  const env = cmd.text.trim() || 'staging';
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      response_type: env === 'prod' ? 'in_channel' : 'ephemeral',
      text: `${cmd.member.display_name} started a deploy to ${env}`,
    }),
  );
}).listen(8081);
