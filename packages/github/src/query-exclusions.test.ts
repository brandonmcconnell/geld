import { expect, it } from 'vitest';
import { parseQuery, serializeQuery, setQualifier } from './query';

it('keeps negative quoted qualifiers intact while editing an unrelated filter', () => {
  const query = 'is:open -label:"needs review" -author:someone parser';
  expect(serializeQuery(parseQuery(query))).toBe(query);
  expect(setQualifier(query, 'is', 'closed')).toBe('-label:"needs review" -author:someone parser is:closed');
});

it('keeps quoted literal filters as text while editing another qualifier', () => {
  const query = '"label:bug" "-author:someone" is:open';
  expect(serializeQuery(parseQuery(query))).toBe(query);
  expect(setQualifier(query, 'is', 'closed')).toBe('"label:bug" "-author:someone" is:closed');
});
