import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_URL = new URL('../scripts/workbench/activity-field-adapter.mjs', import.meta.url);
async function load(){const u=new URL(MODULE_URL);u.searchParams.set('t',`${Date.now()}-${Math.random()}`);return import(u.href);}

class StringField {}
class FormulaField {}
class NumberField {}
class BooleanField {}
class ArrayField {}
class ObjectField {}
class SchemaField { constructor(fields){this.fields=fields;} }

function fixture(){
  const source={
    _id:'a1',type:'attack',name:'Attack',img:'icon.svg',sort:0,
    activation:{type:'action',value:1,override:false},
    consumption:{spellSlot:false,targets:[{type:'itemUses',value:'1'}]},
    description:{chatFlavor:'Hello'},
    duration:{value:'1',units:'round',concentration:false,override:false},
    effects:[{_id:'e1'}],flags:{module:{keep:true}},
    range:{value:'30',units:'ft',override:false},
    target:{prompt:true,override:false,affects:{count:'1',type:'creature',choice:false},template:{contiguous:false,units:'ft'}},
    uses:{spent:0,max:'@prof',recovery:[]},
    visibility:{requireAttunement:false,requireIdentification:true,requireMagic:false,level:{min:1}},
    useConditionText:'condition',useConditionReason:'reason',effectConditionText:'effect condition',macroData:{name:'M',command:'x'},
    attack:{flat:false},midiProperties:{unknown:true},
  };
  const fields={
    _id:new StringField(),type:new StringField(),name:new StringField(),img:new StringField(),sort:new NumberField(),
    activation:new SchemaField({type:new StringField(),value:new NumberField(),override:new BooleanField()}),
    consumption:new SchemaField({spellSlot:new BooleanField(),targets:new ArrayField()}),
    description:new SchemaField({chatFlavor:new StringField()}),
    duration:new SchemaField({value:new FormulaField(),units:new StringField(),concentration:new BooleanField(),override:new BooleanField()}),
    effects:new ArrayField(),flags:new ObjectField(),
    range:new SchemaField({value:new FormulaField(),units:new StringField(),override:new BooleanField()}),
    target:new SchemaField({prompt:new BooleanField(),override:new BooleanField(),affects:new SchemaField({count:new FormulaField(),type:new StringField(),choice:new BooleanField()}),template:new SchemaField({contiguous:new BooleanField(),units:new StringField()})}),
    uses:new SchemaField({spent:new NumberField(),max:new FormulaField(),recovery:new ArrayField()}),
    visibility:new SchemaField({requireAttunement:new BooleanField(),requireIdentification:new BooleanField(),requireMagic:new BooleanField(),level:new ObjectField()}),
    useConditionText:new StringField(),useConditionReason:new StringField(),effectConditionText:new StringField(),macroData:new ObjectField(),
    attack:new SchemaField({flat:new BooleanField()}),midiProperties:new ObjectField(),
  };
  return {type:'attack',schema:{fields},toObject(){return structuredClone(source);}};
}

test('ACT-002 reads only common Activity fields and supported condition/macro extensions',async()=>{
 const {readActivityCommonFields}=await load();
 const fields=readActivityCommonFields(fixture());const paths=fields.map(f=>f.path);
 for(const path of ['img','activation.type','consumption.targets','duration.value','effects','flags','range.value','target.affects.count','uses.max','visibility.requireIdentification','useConditionText','macroData']) assert.ok(paths.includes(path),path);
 assert.ok(!paths.some(p=>p.startsWith('attack.')));
 assert.ok(!paths.some(p=>p.startsWith('midiProperties')));
 assert.ok(!paths.includes('name'));
 assert.ok(!paths.includes('sort'));
});

test('ACT-002 maps structured common fields to JSON and primitives to direct controls',async()=>{
 const {readActivityCommonFields}=await load();const by=Object.fromEntries(readActivityCommonFields(fixture()).map(f=>[f.path,f]));
 assert.equal(by['activation.value'].kind,'number');
 assert.equal(by['duration.value'].kind,'text');
 assert.equal(by['target.prompt'].kind,'boolean');
 assert.equal(by['consumption.targets'].kind,'json');
 assert.equal(by['flags'].kind,'json');
});

test('ACT-002 builds dotted partial updates and preserves untouched fields',async()=>{
 const {buildActivityFieldUpdate}=await load();
 const update=buildActivityFieldUpdate([
  {path:'activation.type',kind:'text',original:'action',value:'bonus'},
  {path:'target.prompt',kind:'boolean',original:true,value:false},
  {path:'flags',kind:'json',original:{module:{keep:true}},value:'{"module":{"keep":true},"ncm":{"x":1}}'},
  {path:'uses.max',kind:'text',original:'@prof',value:'@prof'},
 ]);
 assert.deepEqual(update,{'activation.type':'bonus','target.prompt':false,flags:{module:{keep:true},ncm:{x:1}}});
});

test('ACT-003 exposes only native discriminator roots using the selected subclass schema', async()=>{
 const {readActivitySpecificFields}=await load();
 const a=fixture();
 const nativeClass={metadata:{type:'attack'},schema:{fields:{
  _id:{},type:{},name:{},img:{},sort:{},activation:{},consumption:{},description:{},duration:{},effects:{},flags:{},range:{},target:{},uses:{},visibility:{},attack:{},damage:{}
 }}};
 const fields=readActivitySpecificFields(a,nativeClass);const paths=fields.map(f=>f.path);
 assert.ok(paths.includes('attack.flat'));
 assert.ok(!paths.some(p=>p.startsWith('activation.')));
 assert.ok(!paths.some(p=>p.startsWith('midiProperties')));
});

test('ACT-003 recognizes all twelve D&D5e core discriminator names', async()=>{
 const {CORE_ACTIVITY_TYPES}=await load();
 assert.deepEqual([...CORE_ACTIVITY_TYPES].sort(),['attack','cast','check','damage','enchant','forward','heal','order','save','summon','transform','utility'].sort());
});

test('Activity field adapters treat blank controls for null or missing source values as no-op', async()=>{
 const {buildActivityFieldUpdate}=await load();
 assert.deepEqual(buildActivityFieldUpdate([
  {path:'range.value',kind:'text',original:null,value:''},
  {path:'macroData',kind:'json',original:undefined,value:''},
  {path:'settings.transformTokens',kind:'boolean',original:undefined,value:false},
 ]),{});
});

test('Activity field adapter treats custom Field classes with structured source values as JSON', async()=>{
 const {readActivityCommonFields}=await load();
 class CustomField {}
 const a=fixture();
 a.schema.fields.consumption.fields.targets=new CustomField();
 a.schema.fields.flags=new CustomField();
 const by=Object.fromEntries(readActivityCommonFields(a).map(f=>[f.path,f]));
 assert.equal(by['consumption.targets'].kind,'json');
 assert.equal(by.flags.kind,'json');
});

test('UI-004 Activity field adapter exposes schema choices as select options', async()=>{
 const {readActivityCommonFields}=await load();
 class ChoiceField { constructor(){ this.choices={action:'Action',bonus:'Bonus'}; } }
 const a=fixture();
 a.schema.fields.activation.fields.type=new ChoiceField();
 a.toObject=()=>({activation:{type:'action'},consumption:{targets:[]},description:{chat:''},flags:{},range:{value:null},target:{prompt:true},visibility:'all'});
 const field=readActivityCommonFields(a).find(f=>f.path==='activation.type');
 assert.equal(field.hasChoices,true);
 assert.deepEqual(field.options.map(o=>[o.value,o.label,o.selected]),[['','없음',false],['action','Action',true],['bonus','Bonus',false]]);
});

test('purpose-first advanced Activity field labels are Korean while paths remain machine-readable', async()=>{
  const {readActivityCommonFields}=await load();
  const fields=readActivityCommonFields(fixture());
  const activation=fields.find(f=>f.path==='activation.type');
  const range=fields.find(f=>f.path==='range.value');
  assert.equal(activation.label,'발동 › 유형');
  assert.equal(range.label,'사거리 › 값');
  assert.equal(activation.path,'activation.type');
});
