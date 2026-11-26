import { act, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PoolseInbox } from '../src/index.js';
import { errorResponse, me } from './_fixtures.js';
import { jsonResponse, renderWithProvider, routedFetch } from './_helpers.js';

describe('<PoolseInbox>', () => {
  it('says so when "New chat" cannot create the conversation', async () => {
    const { container, getByLabelText, getByText } = renderWithProvider(
      <PoolseInbox users={[{ externalId: 'dana', name: 'Dana' }]} />,
      routedFetch({
        'GET /v1/me': () => jsonResponse(me),
        'GET /v1/conversations': () => jsonResponse({ data: [], next_cursor: null }),
        'GET /v1/presence': () => jsonResponse({ data: [] }),
        'POST /v1/conversations': () => errorResponse(422, 'invalid'),
      }),
    );
    fireEvent.click(getByLabelText('New chat'));
    await act(async () => {
      fireEvent.click(getByText('Dana'));
    });
    await waitFor(() =>
      expect(container.querySelector('.poolse-inbox__notice')?.textContent).toBe(
        "Couldn't start the chat. Try again.",
      ),
    );
  });
});
