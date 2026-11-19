// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { Avatar } from '../components/Avatar';

describe('Avatar', () => {
  it('shows initials and keeps the image invisible until it loads', () => {
    const { container } = render(<Avatar name="Alex Rivera" url="https://avatars.example.test/alex" />);
    expect(screen.getByText('AR')).toBeInTheDocument();
    const image = container.querySelector('img')!;
    expect(image).toHaveStyle({ opacity: '0' });
    fireEvent.load(image);
    expect(image).toHaveStyle({ opacity: '1' });
  });

  it('drops the image and keeps the initials when it fails to load', () => {
    const { container } = render(<Avatar name="platform-team" url="https://avatars.example.test/broken" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('PT')).toBeInTheDocument();
  });

  it('gives the same name the same tint every time', () => {
    const first = render(<Avatar name="sam" />).container.firstElementChild!.className;
    const second = render(<Avatar name="sam" />).container.firstElementChild!.className;
    expect(first).toBe(second);
    expect(first).toMatch(/av-\d/);
  });
});
