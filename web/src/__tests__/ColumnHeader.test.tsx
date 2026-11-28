// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { ColumnHeader } from '../components/ColumnHeader';

const heads = (container: HTMLElement) => [...container.querySelectorAll('.sig-heads span')].map((span) => [span.textContent, span.getAttribute('title')]);

describe('ColumnHeader', () => {
  it('shows configured reviewer columns with their abbreviation and name', () => {
    const { container } = render(<ColumnHeader reviewers={{ aiReview: { name: 'Copilot', short: 'Cop', show: true }, codeAnalysis: { name: 'SonarQube Cloud', short: 'SQ', show: true } }} />);
    expect(heads(container)).toEqual([['CI', 'CI'], ['Cop', 'Copilot'], ['SQ', 'SonarQube Cloud'], ['Rev', 'Review'], ['Thr', 'Threads'], ['Mrg', 'Mergeable']]);
  });

  it('leaves out hidden and unconfigured reviewer columns', () => {
    const { container } = render(<ColumnHeader reviewers={{ aiReview: { name: 'Copilot', short: 'Cop', show: false }, codeAnalysis: null }} />);
    expect(heads(container).map(([text]) => text)).toEqual(['CI', 'Rev', 'Thr', 'Mrg']);
  });
});
