export interface DescriptiveStats {
  count: number;
  sum: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  missingCount: number;
}

export interface RankedItem {
  item: string | number;
  value: number;
  rank: number;
}

/**
 * Validated deterministic calculation utility for arithmetic, descriptive statistics,
 * rankings, units handling, missing-value filtering, and zero-denominator safety.
 */
export class DeterministicTools {
  calculateStats(inputs: Array<number | null | undefined>, units?: string): { stats: DescriptiveStats; formattedSummary: string } {
    const valid = inputs.filter((n): n is number => typeof n === 'number' && !isNaN(n) && n !== null && n !== undefined);
    const missingCount = inputs.length - valid.length;

    if (valid.length === 0) {
      return {
        stats: { count: 0, sum: 0, mean: 0, median: 0, min: 0, max: 0, missingCount },
        formattedSummary: `No valid numeric data (Missing values: ${missingCount}). Units: ${units ?? 'none'}`
      };
    }

    const sorted = [...valid].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const mean = sum / count;
    const mid = Math.floor(count / 2);
    const median = count % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const min = sorted[0];
    const max = sorted[count - 1];

    const stats: DescriptiveStats = { count, sum, mean, median, min, max, missingCount };
    const unitStr = units ? ` ${units}` : '';
    const formattedSummary = `Count: ${count}, Sum: ${sum}${unitStr}, Mean: ${mean.toFixed(2)}${unitStr}, Median: ${median}${unitStr}, Min: ${min}${unitStr}, Max: ${max}${unitStr} (Missing: ${missingCount})`;

    return { stats, formattedSummary };
  }

  percentChange(oldVal: number, newVal: number): { percentChange: number; description: string } {
    if (oldVal === 0 || isNaN(oldVal) || isNaN(newVal)) {
      if (oldVal === 0 && newVal === 0) return { percentChange: 0, description: '0% change (both zero)' };
      return { percentChange: 0, description: 'Zero denominator or invalid values encountered; percentage change undefined.' };
    }
    const pc = ((newVal - oldVal) / Math.abs(oldVal)) * 100;
    return { percentChange: pc, description: `${pc >= ِّف ? '+' : ''}${pc.toFixed(2)}% change` };
  }

  computeRankings(items: Array<{ item: string | number; value: number }>): RankedItem[] {
    const sorted = [...items].sort((a, b) => b.value - a.value);
    return sorted.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
  }
}
