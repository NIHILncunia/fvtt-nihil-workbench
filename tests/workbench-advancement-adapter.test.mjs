import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_URL = new URL('../scripts/workbench/advancement-adapter.mjs', import.meta.url);
async function load(){ const u=new URL(MODULE_URL); u.searchParams.set('t',`${Date.now()}-${Math.random()}`); return import(u.href); }

class StringField {}
class NumberField {}
class BooleanField {}
class ArrayField {}
class MappingField {}
class SchemaField { constructor(fields={}){ this.fields=fields; } }

function advancement(id='a1', type='Trait', source={}) {
  const Config = class Config {};
  Config.schema={fields:{
    allowReplacements:new BooleanField(),
    grants:new ArrayField(),
    nested:new SchemaField({mode:new StringField()}),
  }};
  const Value = class Value {};
  Value.schema={fields:{chosen:new MappingField()}};
  class Adv {}
  Adv.typeName=type;
  Adv.schema={fields:{level:new NumberField(),title:new StringField(),hint:new StringField(),icon:new StringField(),classRestriction:new StringField()}};
  Adv.metadata={dataModels:{configuration:Config,value:Value}};
  const data={_id:id,type,level:0,title:'Traits',hint:'',icon:'',configuration:{allowReplacements:false,grants:[],nested:{mode:'default'}},value:{chosen:{}},...source};
  return {id,_id:id,type,constructor:Adv,toObject(){return structuredClone(data);},sheet:{render(){this.rendered=true;}}};
}

function itemFixture(){
  const list=[advancement('a1')];
  const item={
    type:'race',
    advancement:{byId:{a1:list[0]}},
    toObject(){return {system:{advancement:list.map(a=>a.toObject())}};},
    async createAdvancement(type,data,{renderSheet}={}){
      assert.equal(renderSheet,false);
      const id=`a${list.length+1}`;
      const a=advancement(id,type,{...data,_id:id,type}); list.push(a); this.advancement.byId[id]=a; return this;
    },
    async updateAdvancement(id,updates){ this.lastAdvancementUpdate={id,updates}; return this; },
    async deleteAdvancement(id){ this.deletedAdvancement=id; delete this.advancement.byId[id]; return this; },
    async duplicateAdvancement(id,{showConfig}={}){
      assert.equal(showConfig,false);
      const src=this.advancement.byId[id].toObject(); delete src._id; src.title=`${src.title} (복제)`;
      return this.createAdvancement(src.type,src,{renderSheet:false});
    },
  };
  return item;
}

test('ADV-001 filters creatable Advancement types through valid item types and availability', async()=>{
  const {availableAdvancementTypes}=await load();
  const cfg={
    Trait:{documentClass:{metadata:{title:'Traits'},availableForItem:()=>true},validItemTypes:new Set(['race'])},
    HitPoints:{documentClass:{metadata:{title:'HP'},availableForItem:()=>true},validItemTypes:new Set(['class'])},
    Hidden:{hidden:true,documentClass:{availableForItem:()=>true},validItemTypes:new Set(['race'])},
  };
  assert.deepEqual(availableAdvancementTypes({type:'race'},cfg).map(x=>x.value),['Trait']);
});

test('ADV-001 creates duplicates and deletes through native Item Advancement APIs', async()=>{
  const {createAdvancement,duplicateAdvancement,deleteAdvancement}=await load();
  const item=itemFixture();
  const created=await createAdvancement(item,'Trait',{title:'Created'});
  assert.equal(created.type,'Trait');
  assert.equal(created.toObject().title,'Created');
  const copy=await duplicateAdvancement(item,'a1');
  assert.notEqual(copy.id,'a1');
  assert.equal(copy.toObject().title,'Traits (복제)');
  await deleteAdvancement(item,'a1');
  assert.equal(item.deletedAdvancement,'a1');
});

test('ADV-002 exposes common plus configuration/value schema fields without dropping structured values', async()=>{
  const {readAdvancementFields}=await load();
  const fields=readAdvancementFields(advancement());
  const by=Object.fromEntries(fields.map(f=>[f.path,f]));
  assert.equal(by.level.kind,'number');
  assert.equal(by.title.kind,'text');
  assert.equal(by['configuration.allowReplacements'].kind,'boolean');
  assert.equal(by['configuration.grants'].kind,'json');
  assert.equal(by['configuration.nested.mode'].value,'default');
  assert.equal(by['value.chosen'].kind,'json');
});

test('ADV-002 builds dotted partial updates and preserves no-op values', async()=>{
  const {readAdvancementFields,buildAdvancementFieldUpdate}=await load();
  const fields=readAdvancementFields(advancement()).map(f=>f.path==='configuration.nested.mode'?{...f,value:'replace'}:f);
  assert.deepEqual(buildAdvancementFieldUpdate(fields),{'configuration.nested.mode':'replace'});
});

test('ADV-002 recognizes all eight D&D5e core Advancement types', async()=>{
  const {CORE_ADVANCEMENT_TYPES}=await load();
  assert.deepEqual([...CORE_ADVANCEMENT_TYPES].sort(),['AbilityScoreImprovement','HitPoints','ItemChoice','ItemGrant','ScaleValue','Size','Subclass','Trait'].sort());
});

test('Advancement editor uses Korean labels for known field paths', async()=>{
  const {readAdvancementFields}=await load();
  const by=Object.fromEntries(readAdvancementFields(advancement()).map(f=>[f.path,f]));
  assert.equal(by.level.label,'레벨');
  assert.equal(by.title.label,'제목');
  assert.equal(by['configuration.allowReplacements'].label,'설정 / 교체 허용');
  assert.equal(by['value.chosen'].label,'값 / 선택값');
});
