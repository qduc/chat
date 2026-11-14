/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { QualitySlider } from '../components/ui/QualitySlider';

test('shows exactly the five reasoning effort levels', () => {
  render(<QualitySlider value="unset" onChange={() => {}} />);

  const labels = screen.getAllByRole('option').map((option) => option.textContent);
  expect(labels).toEqual(['Unset', 'None', 'Low', 'Medium', 'High', 'X-High']);

  const efforts = screen
    .getAllByRole('option')
    .map((option) => (option as HTMLOptionElement).value)
    .filter((value) => value !== 'unset');
  expect(efforts).toEqual(['none', 'low', 'medium', 'high', 'xhigh']);
  expect(screen.queryByRole('option', { name: 'Minimal' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Max' })).not.toBeInTheDocument();
});

test('shows a saved minimal on None without offering Minimal', () => {
  const onChange = jest.fn();
  render(<QualitySlider value="minimal" onChange={onChange} />);

  expect(screen.getByRole('combobox')).toHaveValue('none');
  expect(screen.queryByRole('option', { name: 'Minimal' })).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});
