import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_URL = new URL('../scripts/workbench/activity-adapter.mjs', import.meta.url);
async function load() { const u=new URL(MODULE_URL); u.searchParams.set('t',`${Date.now()}-${Math.random()}`); return import(u.href); }

function activity(id,name,type='attack',sort=0,extra={}) {
  return {
    id, _id:id, name, type, sort,
    toObject(){ return {_id:id,name,type,sort,flags:{thirdParty:{keep:true}},...extra}; },
    async update(data){ Object.assign(this,data); return this; },
    async delete(){ this.deleted=true; return true; },
  };
}

function itemFixture() {
  const acts=new Map([
    ['a',activity('a','Alpha','attack',1000)],
    ['b',activity('b','Beta','save',2000)],
    ['c',activity('c','Gamma','utility',3000)],
  ]);
  return {
    system:{activities:acts},
    async createActivity(type,data,{renderSheet}={}) {
      assert.equal(renderSheet,false);
      const id=`new${acts.size}`;
      acts.set(id,activity(id,data.name??'',type,data.sort??0,data));
    },
    async update(data){
      this.lastUpdate=data;
      const activityUpdates=data?.['system.activities'] ?? {};
      for (const [id, update] of Object.entries(activityUpdates)) {
        const current=acts.get(id);
        if (current) Object.assign(current, update);
      }
      return this;
    },
  };
}

test('ACT-001 filters creatable Activity types through D&D5e availability', async()=>{
  const { availableActivityTypes }=await load();
  const item={};
  const config={
    attack:{label:'Attack',documentClass:{availableForItem:()=>true}},
    cast:{label:'Cast',configurable:false,documentClass:{availableForItem:()=>true}},
    order:{label:'Order',documentClass:{availableForItem:()=>false}},
    custom:{label:'Custom',documentClass:{}},
  };
  assert.deepEqual(availableActivityTypes(item,config).map(x=>x.value),['attack','custom']);
});

test('ACT-001 creates and returns the newly stored Activity', async()=>{
  const { createActivity }=await load();
  const item=itemFixture();
  const created=await createActivity(item,'damage',{name:'New Damage'});
  assert.equal(created.type,'damage');
  assert.equal(created.name,'New Damage');
});

test('ACT-001 duplicate preserves unknown source data while assigning a new id', async()=>{
  const { duplicateActivity }=await load();
  const item=itemFixture();
  const copy=await duplicateActivity(item,'a');
  assert.notEqual(copy.id,'a');
  assert.equal(copy.name,'Alpha (복제)');
  assert.deepEqual(copy.toObject().flags,{thirdParty:{keep:true}});
});

test('ACT-001 rename and delete delegate to Activity document APIs', async()=>{
  const { renameActivity, deleteActivity }=await load();
  const item=itemFixture();
  await renameActivity(item,'a','Renamed');
  assert.equal(item.system.activities.get('a').name,'Renamed');
  await deleteActivity(item,'a');
  assert.equal(item.system.activities.get('a').deleted,true);
});


test('ACT-001 respects native availableForItem and does not force unsupported Order creation', async()=>{
  const { availableActivityTypes }=await load();
  const config={
    order:{label:'Order',documentClass:{availableForItem:()=>false}},
    utility:{label:'Utility',documentClass:{availableForItem:()=>true}},
  };
  assert.deepEqual(availableActivityTypes({type:'facility'},config).map(x=>x.value),['utility']);
});

test('ACT-001 move builds sort-only partial updates in the requested order', async()=>{
  const { moveActivity }=await load();
  const item=itemFixture();
  await moveActivity(item,'b',-1);
  assert.deepEqual(item.lastUpdate,{'system.activities':{
    b:{sort:1000},a:{sort:2000},c:{sort:3000},
  }});
  await moveActivity(item,'b',1);
  assert.deepEqual(item.lastUpdate,{'system.activities':{
    a:{sort:1000},b:{sort:2000},c:{sort:3000},
  }});
});
