// AgentBadge — the "Agent" pill next to an agent's name (AG1). An agent
// is never shown as a person: wherever its name appears, so does this.

export interface AgentBadgeProps {
  /** `sm` (default) beside names in lists; `xs` in dense rows. */
  size?: 'xs' | 'sm';
  /** Defaults to "Agent". */
  label?: string;
  className?: string;
}

export function AgentBadge({ size = 'sm', label = 'Agent', className }: AgentBadgeProps) {
  return (
    <span
      className={['poolse-agent-badge', size === 'xs' ? 'poolse-agent-badge--xs' : null, className]
        .filter(Boolean)
        .join(' ')}
      title="This is an AI agent, not a person"
    >
      {label}
    </span>
  );
}
