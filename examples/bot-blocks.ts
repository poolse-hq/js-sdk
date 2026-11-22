// A Workspace app's bot posts an interactive message and answers its
// actions. Needs: an installed app with `messages:write` and a bot token
// (`wsbt_…`), and its `interactivity_url` pointing at this server.
// Public API: POST /workspace/api/<method> (apps/workspace/INTEGRATIONS.md §3).

import { createServer } from 'node:http';

const WORKSPACE = process.env.WORKSPACE_URL!; // https://chat.example.com
const BOT_TOKEN = process.env.BOT_TOKEN!;

async function api<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${WORKSPACE}/workspace/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${BOT_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function askForApproval(channelId: string, version: string) {
  return api('messages.post', {
    channel_id: channelId,
    text: `Deploy ${version} is waiting for approval`, // the fallback text
    blocks: [
      { type: 'section', text: `**Deploy ${version}** is waiting` },
      {
        type: 'input',
        action_id: 'reason',
        label: 'Reason',
        input: 'textarea',
        required: true,
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'select',
            action_id: 'env',
            placeholder: 'Environment',
            options: [
              { text: 'Staging', value: 'staging' },
              { text: 'Production', value: 'prod' },
            ],
          },
          { type: 'button', action_id: 'approve', text: 'Approve', style: 'primary', submit: true },
          { type: 'button', action_id: 'reject', text: 'Reject', style: 'danger', value: version },
        ],
      },
    ],
  });
}

// The Workspace POSTs each action here: {type: "block_action", action, message, member, response_url}.
createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const evt = JSON.parse(raw) as {
    type: string;
    action: { action_id: string; values?: Record<string, string | string[]> };
    member: { display_name: string };
  };
  res.setHeader('content-type', 'application/json');
  if (evt.action.action_id === 'approve') {
    const reason = evt.action.values?.reason ?? '';
    res.end(
      JSON.stringify({
        replace_original: true,
        text: `Approved by ${evt.member.display_name}`,
        blocks: [
          { type: 'section', text: `✅ Approved by **${evt.member.display_name}**` },
          { type: 'context', text: String(reason) },
        ],
      }),
    );
  } else if (evt.action.action_id === 'reject') {
    res.end(JSON.stringify({ replace_original: true, text: 'Rejected' }));
  } else {
    res.end('{}');
  }
}).listen(8080);
