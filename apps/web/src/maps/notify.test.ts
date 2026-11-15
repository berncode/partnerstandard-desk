import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() });
vi.mock('sonner', () => ({ toast }));
const { sonnerNotify } = await import('./notify');

describe('sonnerNotify', () => {
  beforeEach(() => { toast.mockClear(); toast.error.mockClear(); });

  it('labels the action Retry by default', () => {
    const onRetry = () => {};
    sonnerNotify.error('Couldn’t save', onRetry);
    expect(toast.error).toHaveBeenCalledWith('Couldn’t save', { action: { label: 'Retry', onClick: onRetry } });
  });

  it('uses the given action label', () => {
    const onReconnect = () => {};
    sonnerNotify.error('Google needs your permission again.', onReconnect, 'Reconnect Google');
    expect(toast.error).toHaveBeenCalledWith('Google needs your permission again.', { action: { label: 'Reconnect Google', onClick: onReconnect } });
  });

  it('shows no action without a handler', () => {
    sonnerNotify.error('Something went wrong');
    expect(toast.error).toHaveBeenCalledWith('Something went wrong', undefined);
  });

  it('shows one undo toast with an Undo button', () => {
    const onUndo = () => {};
    sonnerNotify.undo('Activity added', onUndo);
    expect(toast).toHaveBeenCalledWith('Activity added', { id: 'map-undo', duration: 5000, action: { label: 'Undo', onClick: onUndo } });
  });
});
