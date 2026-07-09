import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders MOMO Shogi header title', () => {
    render(<App variant="b" />);
    expect(screen.getByText(/MOMO/)).toBeInTheDocument();
    expect(screen.getByText(/Shogi/)).toBeInTheDocument();
  });

  it('renders 81 board cells', () => {
    const { container } = render(<App variant="b" />);
    expect(container.querySelectorAll('.sq').length).toBe(81);
  });

  it('renders the resign command button', () => {
    render(<App variant="a" />);
    expect(screen.getByRole('button', { name: /投了|Resign|认输|まいった/ })).toBeInTheDocument();
  });
});
