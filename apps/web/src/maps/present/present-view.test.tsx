// @vitest-environment jsdom
import { joinPlan } from '@partner-desk/core';
import { makeActivity, makeMapPlan, MAP_NOW, MAP_TODAY } from '@partner-desk/core/test-builders';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SAMPLE_PLAN, SAMPLE_RECORD } from '@/test/map-workspace';
import { PresentView } from './present-view';

const sample = joinPlan(SAMPLE_PLAN, SAMPLE_RECORD, MAP_TODAY);

describe('PresentView', () => {
  it('names both companies in the title and every side heading, never “Us”', () => {
    render(<PresentView plan={sample} today={MAP_TODAY} lastEventAt={MAP_NOW} ownerName="Anna Keller" ourName="Halden" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Halden ×\s*and Brightwave Systems/);
    expect(screen.getByRole('heading', { level: 3, name: 'Halden’s objectives' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Halden' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Brightwave Systems' })).toBeInTheDocument();
    expect(screen.queryByText('Us')).toBeNull();
  });

  it('names our side after the person until the company has a name', () => {
    render(<PresentView plan={sample} today={MAP_TODAY} lastEventAt={MAP_NOW} ownerName="Anna Keller" ourName="" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Anna Keller ×\s*and Brightwave Systems/);
  });

  it('shows the health, stage, horizon and why it needs attention, read-only', () => {
    render(<PresentView plan={sample} today={MAP_TODAY} lastEventAt={MAP_NOW} ownerName="Anna Keller" />);
    expect(screen.getByText('At risk')).toBeInTheDocument();
    expect(screen.getByText('Onboarding')).toBeInTheDocument();
    expect(screen.getByText('Horizon 1')).toBeInTheDocument();
    expect(screen.getByText(/is 14 days overdue/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says "Nothing planned yet" for a MAP with no activity and no milestone, not "On track" (owner, 2026-10-31)', () => {
    const plan = joinPlan(makeMapPlan(), SAMPLE_RECORD, MAP_TODAY);
    render(<PresentView plan={plan} today={MAP_TODAY} lastEventAt={MAP_NOW} ownerName="Anna Keller" />);
    expect(screen.getByText('Nothing planned yet')).toBeInTheDocument();
    expect(screen.queryByText('On track')).toBeNull();
  });

  it('says what is missing, with no dash in an empty cell', () => {
    const plan = joinPlan(makeMapPlan({ activities: [makeActivity({ id: 'a_1', title: 'Kickoff' })] }), { ...SAMPLE_RECORD, signedDate: null, stage: 'recruitment' }, MAP_TODAY);
    render(<PresentView plan={plan} today={MAP_TODAY} lastEventAt={MAP_NOW} ownerName="Anna Keller" />);
    expect(screen.getByText('Before signing')).toBeInTheDocument();
    expect(screen.getByText('No objectives agreed yet.')).toBeInTheDocument();
    expect(screen.getByText('None agreed yet.')).toBeInTheDocument();
    const kickoff = screen.getByRole('row', { name: /Kickoff/ });
    expect(within(kickoff).getByText('No owner')).toBeInTheDocument();
    expect(within(kickoff).getByText('No date')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('—');
  });
});
