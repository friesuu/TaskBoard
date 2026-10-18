import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, hasActiveFilters, readFiltersFromUrl, toApiFilter, writeFiltersToUrl } from './filters';

describe('filters', () => {
  beforeEach(() => window.history.replaceState(null, '', '/?board=10'));

  it('no filters: nothing is active and the server gets null', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(toApiFilter(EMPTY_FILTERS)).toBeNull();
  });

  it('blank search text does not count as a filter', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: '   ' })).toBe(false);
  });

  it('turns the filters into what the server expects, leaving out unused ones', () => {
    expect(toApiFilter({ q: ' report ', labels: [3], due: '', status: ['TODO', 'DONE'] }))
      .toEqual({ q: 'report', labelIds: [3], statuses: ['TODO', 'DONE'] });
    expect(toApiFilter({ ...EMPTY_FILTERS, due: 'OVERDUE' })).toEqual({ due: 'OVERDUE' });
  });

  it('writes the filters to the address bar and reads them back', () => {
    const filters = { q: 'report', labels: [3, 7], due: 'THIS_WEEK', status: ['TODO'] };

    writeFiltersToUrl(filters);

    expect(window.location.search).toBe('?board=10&q=report&labels=3%2C7&due=THIS_WEEK&status=TODO');
    expect(readFiltersFromUrl()).toEqual(filters);
  });

  it('removes empty filters from the address bar, keeping the rest', () => {
    writeFiltersToUrl({ q: 'report', labels: [3], due: 'TODAY', status: [] });
    writeFiltersToUrl(EMPTY_FILTERS);

    expect(window.location.search).toBe('?board=10');
  });

  it('ignores nonsense in the address bar', () => {
    window.history.replaceState(null, '', '/?labels=3,abc,,7&due=SOMEDAY');

    expect(readFiltersFromUrl()).toEqual({ q: '', labels: [3, 7], due: '', status: [] });
  });
});
