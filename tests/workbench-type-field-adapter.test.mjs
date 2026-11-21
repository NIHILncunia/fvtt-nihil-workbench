import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_URL = new URL('../scripts/workbench/type-field-adapter.mjs', import.meta.url);
async function load() { const u=new URL(MODULE_URL); u.searchParams.set('t',`${Date.now()}-${Math.random()}`); return import(u.href); }

class StringField { constructor(choices=null){ this.choices=choices; } }
class FormulaField {}
class IdentifierField {}
class NumberField {}
class BooleanField {}
class SetField {}
class ArrayField {}
class MappingField {}
class DocumentUUIDField {}
class SchemaField { constructor(fields){ this.fields=fields; } }

function itemFixture() {
  return {
    type:'weapon',
    system:{
      schema:{ fields:{
        activities:new ArrayField(), uses:new SchemaField({}), advancement:new ArrayField(),
        description:new SchemaField({value:new StringField(),chat:new StringField()}),
        identifier:new IdentifierField(), source:new SchemaField({}), properties:new SetField(),
        type:new SchemaField({value:new StringField({simpleM:'Simple',martialM:'Martial'}),baseItem:new StringField()}),
        range:new SchemaField({value:new NumberField(),long:new NumberField(),units:new StringField()}),
        magicalBonus:new NumberField(), crew:new SchemaField({value:new ArrayField(),max:new NumberField()}),
        damage:new SchemaField({base:new SchemaField({}),versatile:new SchemaField({bonus:new FormulaField(),types:new SetField()})}),
      }},
      description:{value:'main',chat:'chat'}, type:{value:'simpleM',baseItem:''}, range:{value:20,long:60,units:'ft'},
      magicalBonus:1, crew:{value:['Actor.a'],max:2}, damage:{base:{},versatile:{bonus:'+1',types:['slashing']}}, properties:['mgc']
    },
    toObject(){ return {system: structuredClone(this.system, {transfer:[]})}; }
  };
}

test('TYPE engine recursively exposes direct type fields but excludes Activity/Advancement/common fields', async()=>{
  const { readTypeFields } = await load();
  const fields=readTypeFields(itemFixture());
  const paths=fields.map(f=>f.path);
  assert.ok(paths.includes('type.value'));
  assert.ok(paths.includes('range.value'));
  assert.ok(paths.includes('crew.value'));
  assert.ok(paths.includes('damage.versatile.bonus'));
  assert.ok(paths.includes('description.chat'));
  assert.ok(!paths.some(p=>p.startsWith('activities')));
  assert.ok(!paths.some(p=>p.startsWith('advancement')));
  assert.ok(!paths.includes('description.value'));
  assert.ok(!paths.includes('properties'));
  assert.ok(!paths.startsWith?.('damage.base'));
});

test('TYPE engine maps primitive and complex schema fields to safe editors', async()=>{
  const { readTypeFields } = await load();
  const byPath=Object.fromEntries(readTypeFields(itemFixture()).map(f=>[f.path,f]));
  assert.equal(byPath['magicalBonus'].kind,'number');
  assert.equal(byPath['damage.versatile.bonus'].kind,'text');
  assert.equal(byPath['crew.value'].kind,'json');
  assert.equal(byPath['damage.versatile.types'].kind,'json');
});

test('TYPE engine builds dotted updates, parses JSON, and omits no-op values', async()=>{
  const { buildTypeFieldUpdate } = await load();
  const fields=[
    {path:'range.value',kind:'number',original:20,value:'30'},
    {path:'crew.value',kind:'json',original:['Actor.a'],value:'["Actor.a","Actor.b"]'},
    {path:'type.value',kind:'text',original:'simpleM',value:'simpleM'},
    {path:'equipped',kind:'boolean',original:false,value:true},
  ];
  assert.deepEqual(buildTypeFieldUpdate(fields),{
    'system.range.value':30,
    'system.crew.value':['Actor.a','Actor.b'],
    'system.equipped':true,
  });
});

test('TYPE engine rejects invalid JSON rather than corrupting structured fields', async()=>{
  const { buildTypeFieldUpdate } = await load();
  assert.throws(()=>buildTypeFieldUpdate([{path:'crew.value',kind:'json',original:[],value:'[bad'}]),/JSON/);
});

test('UI-003 TYPE engine exposes StringField choices as select options', async()=>{
  const { readTypeFields } = await load();
  const field=readTypeFields(itemFixture()).find(f=>f.path==='type.value');
  assert.equal(field.hasChoices,true);
  assert.deepEqual(field.options.map(o=>[o.value,o.label,o.selected]),[
    ['','없음',false],['simpleM','단순 근접',true],['martialM','군용 근접',false],
  ]);
});

test('TYPE editor uses Korean labels for known schema paths and choices', async()=>{
  const { readTypeFields } = await load();
  const by=Object.fromEntries(readTypeFields(itemFixture()).map(f=>[f.path,f]));
  assert.equal(by['type.value'].label,'유형 / 값');
  assert.equal(by['range.value'].label,'사거리 / 값');
  assert.equal(by['magicalBonus'].label,'마법 보너스');
  assert.deepEqual(by['type.value'].options.map(o=>o.label),['없음','단순 근접','군용 근접']);
});
