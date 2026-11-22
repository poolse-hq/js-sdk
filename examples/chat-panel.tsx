// A web chat panel with the messaging-plus pieces of @poolse/react-ui.

import '@poolse/react-ui/styles.css';
import {
  CustomEmojiProvider,
  PoolseProvider,
  slashCommandsFromWorkspace,
  useFiles,
  useMessages,
  usePoll,
  usePoolse,
  type SlashCommand,
} from '@poolse/react';
import {
  FilesList,
  MentionInput,
  PollCard,
  VoiceMessagePlayer,
  VoiceRecorder,
} from '@poolse/react-ui';
import { mediaMessageOf, type Message } from '@poolse/sdk';
import { useEffect, useState } from 'react';

function PollMessage({ message }: { message: Message }) {
  const p = usePoll(message);
  if (!p.poll) return null;
  return (
    <PollCard
      question={message.body ?? ''}
      poll={p.poll}
      myOptionIds={p.myOptionIds}
      onToggle={(id) => void p.toggle(id)}
      pending={p.pending}
    />
  );
}

function VoiceMessage({ message }: { message: Message }) {
  const chat = usePoolse();
  const a = mediaMessageOf(message);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (a)
      void chat.attachments
        .one(a.id)
        .downloadUrl()
        .then((d) => setSrc(d.url));
  }, [chat, a]);
  return a && src ? <VoiceMessagePlayer src={src} attachment={a} /> : null;
}

function Panel({ conversationId, commands }: { conversationId: string; commands: SlashCommand[] }) {
  const chat = usePoolse();
  const { messages, send } = useMessages(conversationId);
  const files = useFiles(conversationId);
  return (
    <div>
      {messages.map((m) =>
        m.type === 'poll' ? (
          <PollMessage key={m.id} message={m} />
        ) : mediaMessageOf(m) ? (
          <VoiceMessage key={m.id} message={m} />
        ) : (
          <p key={m.id}>{m.body}</p>
        ),
      )}
      <MentionInput
        conversationId={conversationId}
        onSend={(req) => send(req)}
        formattingToolbar
        commands={commands}
        groups={[{ handle: 'design', name: 'Design team', memberCount: 12 }]}
      />
      <VoiceRecorder
        onRecorded={async (blob, durationMs) => {
          const a = await chat.attachments.upload({
            body: blob,
            contentType: blob.type,
            byteSize: blob.size,
            purpose: 'voice',
            durationMs,
          });
          await send({ attachment_ids: [a.id] });
        }}
      />
      <FilesList
        files={files.files}
        hasMore={files.hasMore}
        onLoadMore={() => void files.loadMore()}
      />
    </div>
  );
}

export function App({
  token,
  workspaceUrl,
  conversationId,
}: {
  token: string;
  workspaceUrl: string;
  conversationId: string;
}) {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [emoji, setEmoji] = useState<{ name: string; url: string }[]>([]);
  useEffect(() => {
    // Workspace session calls (your app's own Workspace client).
    void fetch(`${workspaceUrl}/workspace/v1/commands`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((j) => setCommands(slashCommandsFromWorkspace(j.commands)));
    void fetch(`${workspaceUrl}/workspace/v1/emoji`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((j: { emoji: { name: string; url: string }[] }) =>
        setEmoji(j.emoji.map((e) => ({ name: e.name, url: `${workspaceUrl}${e.url}` }))),
      );
  }, [token, workspaceUrl]);
  return (
    <PoolseProvider config={{ apiUrl: workspaceUrl, getToken: async () => token }}>
      <CustomEmojiProvider emoji={emoji}>
        <Panel conversationId={conversationId} commands={commands} />
      </CustomEmojiProvider>
    </PoolseProvider>
  );
}
