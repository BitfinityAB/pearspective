// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { StackDiagram } from '../components/StackDiagram';

const detail = {
  repo: 'orders-api', native: false, number: null, baseRefName: 'main',
  entries: [{ number: 1, title: 'Add storage', state: 'open' as const, position: 1 }],
} as never;

// jsdom has no SVG length API, which d3-zoom reads for its extent.
const lengthStub = { get: () => ({ baseVal: { value: 900 } }), configurable: true };

describe('StackDiagram', () => {
  beforeAll(() => {
    Object.defineProperty(SVGSVGElement.prototype, 'width', lengthStub);
    Object.defineProperty(SVGSVGElement.prototype, 'height', lengthStub);
  });
  afterEach(() => document.documentElement.style.removeProperty('--font-ui'));

  it('redraws with the new theme fonts when themeKey changes', () => {
    document.documentElement.style.setProperty('--font-ui', 'Alpha');
    const props = { detail, viewsByNumber: new Map(), onSelect: () => undefined, label: 'Diagram' };
    const { container, rerender } = render(<StackDiagram {...props} themeKey="a" />);
    const fonts = () => [...container.querySelectorAll('text')].map((node) => node.getAttribute('font-family'));
    expect(fonts()).toContain('Alpha');

    document.documentElement.style.setProperty('--font-ui', 'Beta');
    rerender(<StackDiagram {...props} themeKey="a" />);
    expect(fonts()).toContain('Alpha');
    rerender(<StackDiagram {...props} themeKey="b" />);
    expect(fonts()).toContain('Beta');
    expect(fonts()).not.toContain('Alpha');
  });
});
