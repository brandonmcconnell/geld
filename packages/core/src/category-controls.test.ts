import {describe,expect,it} from 'vitest';
import {DEFAULT_SETTINGS,isCategoryEnabled,normalizeSettings,withCategoryEnabled} from './settings';
import {fieldsFor} from './settings-schema';
describe('shared preference controls',()=>{
 it('uses category defaults and keeps Large diffs enabled after normalization',()=>{
  expect(isCategoryEnabled(DEFAULT_SETTINGS,'tests')).toBe(true);
  const enabled=normalizeSettings(withCategoryEnabled(DEFAULT_SETTINGS,'large',true));
  expect(enabled.hideLargeDiffs).toBe(true);
  expect(isCategoryEnabled(enabled,'large')).toBe(true);
  expect(enabled.categories.large).toBeUndefined();
 });
 it('exposes one personal tracker editor on both settings surfaces',()=>{
  for(const surface of ['site','extension'] satisfies Parameters<typeof fieldsFor>[0][]){
   expect(fieldsFor(surface).filter(field=>field.kind==='issue-tracker')).toHaveLength(1);
  }
 });
});
