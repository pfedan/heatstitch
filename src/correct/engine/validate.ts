import type { Pattern } from '../../model/pattern';
import { sewObjects } from '../../model/objects';
import { openOnPurpose } from '../../model/restitch';
import type { Profile } from '../../validation/profiles';
import { ALL_CHECKS, classify, measurePattern, type Checks, type ValidationResult } from '../../validation/validate';

/** The validation the app shows: fills that are open on purpose do not count as too open. */
export function validateDesign(p: Pattern, profile: Profile, checks: Checks = ALL_CHECKS): ValidationResult {
  const open = p.cmd.length ? openOnPurpose(p, sewObjects(p)) : null;
  return classify(measurePattern(p, open ?? undefined), profile, checks);
}
