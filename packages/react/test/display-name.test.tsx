import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { displayNameOf, UNKNOWN_USER_LABEL, useUserLabel } from '../src/display-name.js';
import { PoolseProvider } from '../src/provider.js';
import { scriptedFetch } from './_helpers.js';

describe('displayNameOf', () => {
  it('labelFor, then the profile, then an agent name, then the fallback', () => {
    const labelFor = (id: string) => (id === 'dana' ? 'Dana' : '');
    expect(displayNameOf('dana', { labelFor, profileName: 'D. Profile' })).toBe('Dana');
    expect(displayNameOf('ana', { labelFor, profileName: 'Ana P.' })).toBe('Ana P.');
    expect(displayNameOf('bot-7', { agentName: 'Scout' })).toBe('Scout');
    expect(displayNameOf('u_8f3a', {})).toBe(UNKNOWN_USER_LABEL);
    expect(displayNameOf(null, { fallback: 'Someone' })).toBe('Someone');
  });

  it('never shows the id, even when a source only echoes it', () => {
    const echo = (id: string) => id;
    expect(displayNameOf('u_8f3a', { labelFor: echo })).toBe('Unknown user');
    expect(displayNameOf('u_8f3a', { labelFor: echo, profileName: 'u_8f3a' })).toBe('Unknown user');
    expect(displayNameOf('u_8f3a', { labelFor: echo, profileName: '  Real  ' })).toBe('Real');
  });
});

describe('useUserLabel', () => {
  it('asks the resolver only when labelFor has no name', async () => {
    const asked: string[] = [];
    const resolver = async (id: string) => {
      asked.push(id);
      return { displayName: `Resolved ${id}` };
    };
    const labelFor = (id: string) => (id === 'dana' ? 'Dana' : id);
    const fetchFn = scriptedFetch([]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PoolseProvider
        config={{
          apiUrl: 'https://chat.test',
          getToken: () => 'jwt',
          fetch: fetchFn,
          userResolver: resolver as never,
        }}
      >
        {children}
      </PoolseProvider>
    );
    const a = renderHook(() => useUserLabel('dana', labelFor), { wrapper });
    expect(a.result.current).toBe('Dana');
    const b = renderHook(() => useUserLabel('ana', labelFor), { wrapper });
    await waitFor(() => expect(b.result.current).toBe('Resolved ana'));
    expect(asked).toEqual(['ana']);
  });
});
