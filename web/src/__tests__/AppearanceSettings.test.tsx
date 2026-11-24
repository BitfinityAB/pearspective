// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceSettings } from '../components/AppearanceSettings';
import { ThemeFileSchema } from '../../../shared/themeSchema';
import { resolveTheme } from '../../../shared/themeResolve';
import type { ThemeInfo } from '../../../shared/types';

const defaults = ThemeFileSchema.parse(JSON.parse(readFileSync('themes/default.json', 'utf8')));
const defaultInfo: ThemeInfo = { id: 'default', name: 'Default', modes: ['light', 'dark'], source: 'builtin', valid: true, warnings: [], theme: resolveTheme('default', defaults, defaults) };
const terminalInfo: ThemeInfo = { id: 'terminal', name: 'Terminal', modes: ['dark'], source: 'builtin', valid: true, warnings: [], theme: resolveTheme('terminal', ThemeFileSchema.parse({ name: 'Terminal', modes: ['dark'], dark: { colors: { accent: '#33ff33' } } }), defaults) };
const calmInfo: ThemeInfo = { id: 'calm', name: 'Calm', modes: ['light', 'dark'], source: 'user', valid: true, warnings: ['Low contrast (2.1:1) for text on bg in dark mode.'], theme: resolveTheme('calm', ThemeFileSchema.parse({ name: 'Calm', modes: ['light', 'dark'], light: { colors: { accent: '#3366ff' } }, dark: { colors: { accent: '#88aaff' } } }), defaults) };
const brokenInfo: ThemeInfo = { id: 'broken', name: 'broken', modes: [], source: 'user', valid: false, error: 'bad.json: not valid JSON', warnings: [] };
const themes = [defaultInfo, terminalInfo, calmInfo, brokenInfo];

const renderTab = (onChoose = vi.fn(async (_id: string) => undefined)) => {
  render(<AppearanceSettings themes={themes} chosen="default" onChoose={onChoose} folderHint="the custom-themes folder next to config.json" />);
  return onChoose;
};

describe('AppearanceSettings', () => {
  it('lists themes as radio options with the chosen one checked', () => {
    renderTab();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /Default/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Terminal/ })).not.toBeChecked();
  });

  it('labels single-mode and custom themes', () => {
    renderTab();
    expect(screen.getByText('dark only')).toBeInTheDocument();
    expect(screen.getAllByText('custom').length).toBeGreaterThan(0);
  });

  it('shows six swatches for each valid theme and none for an invalid one', () => {
    const { container } = render(<AppearanceSettings themes={themes} chosen="default" onChoose={async () => undefined} folderHint="x" />);
    const options = container.querySelectorAll('.theme-option');
    expect(options).toHaveLength(4);
    expect(options[0]!.querySelectorAll('[data-swatch]')).toHaveLength(6);
    expect(options[3]!.querySelectorAll('[data-swatch]')).toHaveLength(0);
  });

  it('chooses another valid theme on click', async () => {
    const onChoose = renderTab();
    await userEvent.click(screen.getByRole('radio', { name: /Terminal/ }));
    expect(onChoose).toHaveBeenCalledWith('terminal');
  });

  it('disables an invalid theme and shows its error', () => {
    renderTab();
    expect(screen.getByRole('radio', { name: /broken/ })).toBeDisabled();
    expect(screen.getByText('bad.json: not valid JSON')).toBeInTheDocument();
  });

  it('shows warnings', () => {
    renderTab();
    expect(screen.getByText('Low contrast (2.1:1) for text on bg in dark mode.')).toBeInTheDocument();
  });

  it('shows an alert when saving the choice fails', async () => {
    renderTab(vi.fn(async () => { throw new Error('theme not found'); }));
    await userEvent.click(screen.getByRole('radio', { name: /Terminal/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('theme not found');
  });

  it('explains how to add a theme', () => {
    renderTab();
    expect(screen.getByText(/the custom-themes folder next to config\.json/)).toHaveTextContent('theme.schema.json');
  });

  it('ties each error and warning to its radio for screen readers', () => {
    renderTab();
    expect(screen.getByRole('radio', { name: /broken/ })).toHaveAccessibleDescription('bad.json: not valid JSON');
    expect(screen.getByRole('radio', { name: /Calm/ })).toHaveAccessibleDescription('Low contrast (2.1:1) for text on bg in dark mode.');
    expect(screen.getByRole('radio', { name: /Terminal/ })).not.toHaveAttribute('aria-describedby');
  });

  describe('overlapping saves', () => {
    const deferred = () => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<undefined>((done, fail) => { resolve = () => done(undefined); reject = fail; });
      return { promise, resolve, reject };
    };
    const setup = () => {
      const saves = [deferred(), deferred()];
      const onChoose = vi.fn((_id: string) => saves[onChoose.mock.calls.length - 1]!.promise);
      const view = render(<AppearanceSettings themes={themes} chosen="default" onChoose={onChoose} folderHint="x" />);
      const rerenderWith = (chosen: string) => view.rerender(<AppearanceSettings themes={themes} chosen={chosen} onChoose={onChoose} folderHint="x" />);
      return { saves, onChoose, rerenderWith };
    };

    it('ends on the last pick when an older save resolves after a newer one', async () => {
      const { saves, onChoose, rerenderWith } = setup();
      await userEvent.click(screen.getByRole('radio', { name: /Terminal/ }));
      await userEvent.click(screen.getByRole('radio', { name: /Calm/ }));
      expect(onChoose.mock.calls.map(([id]) => id)).toEqual(['terminal', 'calm']);
      expect(screen.getByRole('radio', { name: /Calm/ })).toBeChecked();
      await act(async () => { saves[1]!.resolve(); });
      rerenderWith('calm');
      await act(async () => { saves[0]!.resolve(); });
      expect(screen.getByRole('radio', { name: /Calm/ })).toBeChecked();
      expect(screen.getByRole('radio', { name: /Terminal/ })).not.toBeChecked();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('ignores the failure of an older save once a newer pick was made', async () => {
      const { saves } = setup();
      await userEvent.click(screen.getByRole('radio', { name: /Terminal/ }));
      await userEvent.click(screen.getByRole('radio', { name: /Calm/ }));
      await act(async () => { saves[0]!.reject(new Error('old save failed')); });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByRole('radio', { name: /Calm/ })).toBeChecked();
    });
  });
});
