import type { CompanyFacts, Program } from '@partner-desk/core';
import type { FieldErrors } from '../program-editor';

/** What every step screen gets: the program on screen, its company's facts, what is wrong, and how to change it. */
export interface StepProps {
  company: CompanyFacts;
  program: Program;
  errors: FieldErrors;
  onChange: (next: Program) => void;
}
