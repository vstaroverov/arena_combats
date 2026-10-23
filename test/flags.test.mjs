import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {regions} from '../dist/regions.js';
import {flags} from '../dist/flags.js';

test('каждому региону соответствует свой локальный файл флага',async()=>{
  assert.equal(Object.keys(flags).length,regions.length);
  assert.equal(new Set(Object.values(flags).map(f=>f.src)).size,regions.length);
  for(const region of regions){
    const flag=flags[region];assert.ok(flag,region);
    assert.ok(flag.source.startsWith('https://commons.wikimedia.org/wiki/File:'));
    const bytes=await readFile(new URL('../dist/'+flag.src,import.meta.url));
    if(flag.src.endsWith('.svg'))assert.match(bytes.toString(),/<svg[\s>]/);
    else assert.equal(bytes.subarray(1,4).toString(),'PNG');
  }
});
