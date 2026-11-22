import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply,empty,unitList,stockLabel,outstanding,billBalance,dayReport,orderRemaining} from '../public/erp/core.mjs';

function shop() {
  let state=empty(),sequence=0;
  const run=(type,body,date='2026-11-01')=>{
    const result=apply(state,{type,body},{id:'id-'+(++sequence),date,actor:'owner',createdAt:new Date(Date.UTC(2026,10,1,0,0,sequence)).toISOString()});
    state=result.state;return result.result;
  };
  const supplier=run('party',{role:'Supplier',name:'Supplier',address:'Supplier address'});
  const customer=run('party',{role:'Customer',name:'Retailer',address:'Retailer address',area:'West'});
  const item=run('item',{name:'Snack 25g',unit:'pouch',mrp:2000,price:1800,tax:5,hsn:'1234',
    packs:[{name:'strip',contains:10,price:17000},{name:'carton',contains:12,price:200000}]});
  return {get state(){return state},run,supplier,customer,item};
}
const line=(item,quantity,rate=100000)=>({itemId:item,unit:'carton',quantity,rate});

test('single units, intermediate packing, opening stock and packing history',()=>{
  const s=shop();
  assert.deepEqual(unitList(s.state.items[0]).map(u=>u.factor),[1,10,120]);
  s.run('openingStock',{itemId:s.item,unit:'carton',quantity:2,cost:120000});
  s.run('openingStock',{itemId:s.item,unit:'strip',quantity:3,cost:10000});
  s.run('openingStock',{itemId:s.item,unit:'pouch',quantity:4,cost:1000});
  assert.equal(s.state.items[0].stock,274);
  assert.equal(stockLabel(s.state.items[0]),'2 carton + 3 strip + 4 pouch');
  assert.throws(()=>s.run('item',{...s.state.items[0],packs:[{name:'carton',contains:100,price:100000}]}),/stock history/);
  const unit=s.run('item',{name:'Loose bottle',unit:'bottle',packs:[],mrp:2000,price:1800,tax:0});
  assert.equal(unitList(s.state.items.find(i=>i.id===unit)).length,1);
});

test('partial dispatch cycle, rate snapshot, independent customer identity and FIFO allocations',()=>{
  const s=shop();
  s.run('purchase',{partyId:s.supplier,reference:'SUP-01',lines:[line(s.item,7)]});
  const order=s.run('order',{partyId:s.customer,lines:[line(s.item,10,200000)]});
  const snapshot=JSON.stringify(s.state);
  assert.throws(()=>s.run('dispatch',{orderId:order,lines:[{lineId:'0',quantity:8}]}),/Insufficient stock/);
  assert.equal(JSON.stringify(s.state),snapshot);
  const bill=s.run('dispatch',{orderId:order,lines:[{lineId:'0',quantity:7}]});
  assert.equal(s.state.items[0].stock,0);
  assert.equal(orderRemaining(s.state.orders[0])[0].remaining,360);
  assert.equal(billBalance(s.state,bill),1470000);
  s.run('party',{id:s.customer,role:'Customer',name:'Renamed retailer',address:'New address',area:'East'});
  assert.equal(s.state.documents.find(d=>d.id===bill).area,'West');
  s.run('receipt',{partyId:s.customer,amount:500000,method:'UPI'});
  assert.equal(billBalance(s.state,bill),970000);
  s.run('delivered',{id:bill});
  assert.equal(s.state.items[0].stock,0);
  assert.throws(()=>s.run('delivered',{id:bill}),/already closed/);
  s.run('purchase',{partyId:s.supplier,reference:'SUP-02',lines:[line(s.item,3)]});
  const last=s.run('dispatch',{orderId:order,lines:[{lineId:'0',quantity:3}]});
  assert.equal(orderRemaining(s.state.orders[0])[0].remaining,0);
  s.run('receipt',{partyId:s.customer,amount:1600000,method:'Cash'});
  assert.equal(outstanding(s.state,s.customer),0);
  assert.equal(billBalance(s.state,last),0);
  const other=s.run('party',{role:'Customer',name:'Renamed retailer',address:'Other shop',area:'West'});
  assert.equal(outstanding(s.state,other),0);
});

test('free quantities, return conditions, credits, refunds and over-return prevention',()=>{
  const s=shop();
  const purchase=s.run('purchase',{partyId:s.supplier,reference:'P1',lines:[{...line(s.item,2),free:1}]});
  assert.equal(s.state.items[0].stock,360);
  assert.equal(outstanding(s.state,s.supplier),210000);
  assert.equal(s.state.items[0].cost,200000/360);
  const sale=s.run('sale',{partyId:s.customer,lines:[line(s.item,2,200000)],paid:100000,method:'Cash'});
  s.run('customerReturn',{sourceId:sale,lineId:'0',quantity:1,amount:210000,condition:'Unsellable',settlement:'Credit'});
  assert.equal(s.state.items[0].stock,120);
  assert.equal(billBalance(s.state,sale),110000);
  assert.throws(()=>s.run('customerReturn',{sourceId:sale,lineId:'0',quantity:2,amount:100,condition:'Sellable',settlement:'Credit'}),/exceeds/);
  s.run('supplierReturn',{sourceId:purchase,lineId:'0',quantity:1,amount:70000,settlement:'Credit'});
  assert.equal(s.state.items[0].stock,0);
  assert.equal(outstanding(s.state,s.supplier),140000);
});

test('day closing counts old-bill receipts today and locks financial posting on closed date',()=>{
  const s=shop();
  s.run('openingStock',{itemId:s.item,unit:'carton',quantity:1,cost:100000});
  const bill=s.run('sale',{partyId:s.customer,lines:[line(s.item,1,200000)]});
  s.run('receipt',{partyId:s.customer,billId:bill,amount:210000,method:'Cash'},'2026-11-02');
  s.run('expense',{amount:10000,method:'Cash',description:'Fuel',category:'Transport'},'2026-11-02');
  const report=dayReport(s.state,'2026-11-02');
  assert.equal(report.sales,0);
  assert.equal(report.methods.find(r=>r.method==='Cash').received,210000);
  s.run('closing',{opening:50000,counted:250000},'2026-11-02');
  assert.equal(s.state.closings[0].difference,0);
  assert.throws(()=>s.run('expense',{amount:1000,method:'Cash',description:'Fuel',category:'Transport'},'2026-11-02'),/day is closed/);
});

test('month of receipts, sales and payments reconciles movements, bills and party balances',()=>{
  const s=shop();
  for(let day=1;day<=28;day++){
    const date='2026-11-'+String(day).padStart(2,'0');
    const purchase=s.run('purchase',{partyId:s.supplier,reference:'P'+day,lines:[line(s.item,2)]},date);
    s.run('payment',{partyId:s.supplier,billId:purchase,amount:210000,method:'Bank'},date);
    const invoice=s.run('sale',{partyId:s.customer,lines:[line(s.item,1,200000)]},date);
    s.run('receipt',{partyId:s.customer,billId:invoice,amount:210000,method:'Cash'},date);
    s.run('expense',{description:'Delivery',category:'Transport',amount:1000,method:'Cash'},date);
    s.run('closing',{opening:0,counted:209000},date);
  }
  assert.equal(s.state.items[0].stock,28*120);
  assert.equal(s.state.movements.reduce((sum,row)=>sum+row.quantity,0),28*120);
  assert.equal(outstanding(s.state,s.customer),0);
  assert.equal(outstanding(s.state,s.supplier),0);
  assert.equal(s.state.closings.length,28);
  assert.ok(s.state.closings.every(row=>row.difference===0));
  assert.equal(new Set(s.state.documents.filter(d=>d.type==='sale').map(d=>d.code)).size,28);
  const restored=JSON.parse(JSON.stringify(s.state));
  assert.equal(outstanding(restored,s.customer),0);
  assert.equal(restored.items[0].stock,28*120);
});

test('dispatch another unit preserves remaining quantity and explicitly selected selling rate',()=>{
  const s=shop();
  s.run('openingStock',{itemId:s.item,unit:'carton',quantity:2,cost:100000});
  const order=s.run('order',{partyId:s.customer,lines:[line(s.item,2,200000)]});
  const invoice=s.run('dispatch',{orderId:order,lines:[{lineId:'0',quantity:3,unit:'strip',rate:17000}]});
  const saved=s.state.documents.find(doc=>doc.id===invoice);
  assert.equal(saved.lines[0].baseQuantity,30);
  assert.equal(saved.lines[0].factor,10);
  assert.equal(saved.lines[0].unit,'strip');
  assert.equal(saved.total,53550);
  assert.equal(orderRemaining(s.state.orders[0])[0].remaining,210);
  assert.equal(s.state.items[0].stock,210);
});

test('mixed units of one item create separate traceable stock movements',()=>{
  const s=shop();
  s.run('openingStock',{itemId:s.item,unit:'carton',quantity:2,cost:100000});
  const invoice=s.run('sale',{partyId:s.customer,lines:[
    {itemId:s.item,unit:'carton',quantity:1,rate:200000},
    {itemId:s.item,unit:'strip',quantity:3,rate:17000},
    {itemId:s.item,unit:'pouch',quantity:4,rate:1800}
  ]});
  assert.equal(s.state.items[0].stock,86);
  assert.equal(s.state.movements.filter(m=>m.source===invoice).length,3);
  assert.equal(s.state.movements.reduce((sum,m)=>sum+m.quantity,0),86);
});
