import test from 'node:test';
import assert from 'node:assert/strict';
import {cities,cityRegions} from '../dist/cities.js';
import {regions} from '../dist/regions.js';
import {flags} from '../dist/flags.js';

test('крупные города связаны с существующими регионами и флагами',()=>{
  assert.equal(cities.length,170);
  assert.equal(new Set(cities.map(c=>c.name)).size,cities.length);
  for(const city of cities){assert.ok(regions.includes(city.region),city.name);assert.ok(flags[city.region],city.name);}
  assert.equal(cityRegions['Казань'],'Татарстан');
  assert.equal(cityRegions['Махачкала'],'Дагестан');
  assert.equal(cityRegions['Екатеринбург'],'Свердловская область');
  assert.equal(cityRegions['Балашиха'],'Московская область');
  const choices=[...regions,...cities.filter(c=>!regions.includes(c.name)).map(c=>c.name)];
  assert.equal(new Set(choices).size,choices.length);
});
