// Hand one note to an agent for one task (NT12). The device has already
// decrypted the note (`noteAsDocument` in @poolse/crypto); this sends only
// that document — as a Markdown file on a message to the agent's
// conversation, mentioning the agent, with the task as the text.
//
// Assumption until poolse documents its "one-off document" for agents:
// agents read the text attachments of a message that mentions them.

import type { Poolse } from './poolse.js';
import type { Message, Uuid } from './types.js';

export interface NoteHandoff {
  /** The conversation with the agent (its DM, or a channel it is in). */
  conversationId: Uuid;
  /** The agent's poolse user id, so the message mentions it. */
  agentUserId?: Uuid;
  /** What the agent should do with it. */
  task: string;
  title: string;
  markdown: string;
}

/** Upload the note as `<title>.md` and send it with the task. */
export async function handNoteToAgent(
  chat: Pick<Poolse, 'attachments' | 'conversations'>,
  handoff: NoteHandoff,
): Promise<Message> {
  const bytes = new TextEncoder().encode(handoff.markdown);
  const safe = handoff.title
    .replace(/[\\/:*?"<>|\s]+/g, ' ')
    .trim()
    .slice(0, 100);
  const file = await chat.attachments.upload({
    body: bytes,
    contentType: 'text/markdown',
    byteSize: bytes.byteLength,
    filename: `${safe || 'Note'}.md`,
  });
  return chat.conversations.one(handoff.conversationId).messages.send({
    body: handoff.task,
    attachment_ids: [file.id],
    ...(handoff.agentUserId ? { mentions: [handoff.agentUserId] } : {}),
  });
}
