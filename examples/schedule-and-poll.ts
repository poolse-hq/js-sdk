// @poolse/sdk as a signed-in member (Node 20+ or a browser).

import { Poolse, isPollClosed } from '@poolse/sdk';

const chat = new Poolse({
  apiUrl: process.env.POOLSE_URL!, // the customer's poolse server
  getToken: async () => process.env.POOLSE_USER_TOKEN!,
});
const conversationId = process.env.CONVERSATION_ID!;
const conv = chat.conversations.one(conversationId).messages;

// Send later (MS1): at 08:00 UTC tomorrow; list and cancel.
const tomorrow8 = new Date();
tomorrow8.setUTCDate(tomorrow8.getUTCDate() + 1);
tomorrow8.setUTCHours(8, 0, 0, 0);
const scheduled = await conv.schedule({
  body: 'Standup notes are in the doc',
  send_at: tomorrow8.toISOString(),
});
console.log(await chat.scheduledMessages.list({ conversation_id: conversationId }));
await chat.scheduledMessages.cancel(scheduled.id);

// A poll (MS3), a vote, and the live result.
const poll = await conv.send({
  type: 'poll',
  body: 'Where do we eat?',
  poll: { options: ['Pizza', 'Sushi'], closes_at: new Date(Date.now() + 3_600_000).toISOString() },
});
const { poll: state } = await chat.messages.one(poll.id).vote(['1']);
console.log(
  state.options.map((o) => `${o.text}: ${o.votes}`),
  isPollClosed(state),
);
chat.realtime.conversation(conversationId).onPollUpdated((e) => console.log('poll', e.poll.voters));

// Pin it (MS13), translate a message (MS21), "what did I miss" (MS20).
await chat.messages.one(poll.id).pin();
const t = await chat.messages.one(poll.id).translate('de');
console.log(t.text);
const missed = await conv.catchUp();
console.log(missed.summary, missed.highlights);

// Data loss prevention (AD6): a warning can be acknowledged; a block can't.
try {
  await conv.send({ body: 'card 4111 1111 1111 1111' });
} catch (err) {
  if ((err as { code?: string }).code === 'dlp_warning') {
    await conv.send({ body: 'card 4111 1111 1111 1111', dlp_acknowledged: true });
  }
}
