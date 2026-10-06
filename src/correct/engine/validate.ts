import type { Pattern } from '../../model/pattern';
import { sewObjects } from '../../model/objects';
import { openOnPurpose } from '../../model/restitch';
import type { Profile } from '../../validation/profiles';
import { ALL_CHECKS, classify, measurePattern, type Checks, type ValidationResult } from '../../validation/validate';

/**
 * The validation the app shows: fills that are open on purpose do not count as too open. Without
 * `gaps`, gaps are not measured (they are never critical, so new critical cells and open density
 * or penetration cells come out the same, much faster).
 */
export function validateDesign(p: Pattern, profile: Profile, checks: Checks = ALL_CHECKS, gaps = true): ValidationResult {
  const open = p.cmd.length ? openOnPurpose(p, sewObjects(p)) : null;
  return classify(measurePattern(p, open ?? undefined, gaps), profile, checks);
}
