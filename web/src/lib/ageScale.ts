import { scaleLog } from 'd3';
import { AGE_DOMAIN_HOURS } from '../../../shared/age';

const scale = scaleLog().domain(AGE_DOMAIN_HOURS).range([0, 100]).clamp(true);

// A minimum width keeps one-hour-old PRs visible on the bar.
export const agePercent = (hours: number) => Math.max(3, scale(Math.max(1, hours)));
