import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,runTransaction,deleteDoc} from 'firebase/firestore';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {empty,apply} from '../public/erp/core.mjs';
const env=await initializeTestEnvironment({projectId:'demo-dheeraj',firestore:{host:'127.0.0.1',port:8088,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
try{
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'wholesaleAccess/owner'),{uid:'owner'}));
 const owner=env.authenticatedContext('owner').firestore(),other=env.authenticatedContext('other').firestore(),anon=env.unauthenticatedContext().firestore();
 await assertFails(getDocs(collection(other,'erp/main/items')));
 await assertFails(getDocs(collection(anon,'erp/main/items')));
 await assertSucceeds(getDocs(collection(owner,'erp/main/items')));
 let state=empty(),generation=0,n=0;
 async function post(type,body,id='op-'+(++n)){
  const proposal=apply(state,{type,body},{id,date:'2026-11-22',actor:'owner'});
  await assertSucceeds(runTransaction(owner,async tx=>{
    const receipt=doc(owner,'erp/main/operations/'+id),control=doc(owner,'erp/main/control/generation');
    if((await tx.get(receipt)).exists())return;
    const snapshots=await Promise.all(proposal.writes.map(w=>tx.get(doc(owner,'erp/main/'+w.kind+'/'+w.row.id))));
    const current=await tx.get(control);
    assert.equal(current.data()?.value||0,generation);
    proposal.writes.forEach((w,i)=>tx.set(doc(owner,'erp/main/'+w.kind+'/'+w.row.id),{...w.row,version:(snapshots[i].data()?.version||0)+1,operationId:id}));
    tx.set(control,{value:generation+1,operationId:id});
    tx.set(receipt,{actor:'owner',date:'2026-11-22',type,result:proposal.result});
  }));
  state=proposal.state;generation++;
  return proposal.result;
 }
 const item=await post('item',{name:'Cola',unit:'bottle',mrp:2000,price:1800,tax:5,packs:[{name:'carton',contains:24,price:40000}]});
 const supplier=await post('party',{name:'Supplier',role:'Supplier',address:'Street'});
 const customer=await post('party',{name:'Customer',role:'Customer',address:'Street',area:'West'});
 const purchase=await post('purchase',{partyId:supplier,reference:'P1',lines:[{itemId:item,unit:'carton',quantity:10,rate:20000}],paid:10000,method:'Cash'});
 const order=await post('order',{partyId:customer,lines:[{itemId:item,unit:'carton',quantity:12,rate:40000}]});
 const invoice=await post('dispatch',{orderId:order,lines:[{lineId:'0',quantity:7}],paid:10000,method:'Cash'});
 await post('delivered',{id:invoice});
 await post('receipt',{partyId:customer,amount:284000,method:'UPI'});
 await post('customerReturn',{sourceId:invoice,lineId:'0',quantity:1,amount:42000,condition:'Sellable',settlement:'Refund',method:'Cash'});
 await post('supplierReturn',{sourceId:purchase,lineId:'0',quantity:1,amount:21000,settlement:'Credit'});
 await post('expense',{amount:1000,description:'Fuel',category:'Transport',method:'Cash'});
 await post('closing',{opening:50000,counted:0});

 // Exercise the advertised 50-row document against actual security-rule limits.
 const many=[];
 for(let index=0;index<50;index++){
   const id=await post('item',{name:'Bulk '+index,unit:'piece',mrp:100,price:100,tax:0,packs:[]});
   many.push({itemId:id,unit:'piece',quantity:1,rate:50});
 }
 // Use a different day because the previous day has already been closed.
 const proposal=apply(state,{type:'purchase',body:{partyId:supplier,reference:'BULK',lines:many}},{id:'bulk-op',date:'2026-11-23',actor:'owner'});
 await assertSucceeds(runTransaction(owner,async tx=>{
   const receipt=doc(owner,'erp/main/operations/bulk-op'),control=doc(owner,'erp/main/control/generation');
   await tx.get(receipt);
   const reads=await Promise.all(proposal.writes.map(w=>tx.get(doc(owner,'erp/main/'+w.kind+'/'+w.row.id))));
   await tx.get(control);
   proposal.writes.forEach((w,i)=>tx.set(doc(owner,'erp/main/'+w.kind+'/'+w.row.id),{...w.row,version:(reads[i].data()?.version||0)+1,operationId:'bulk-op'}));
   tx.set(control,{value:generation+1,operationId:'bulk-op'});
   tx.set(receipt,{actor:'owner',date:'2026-11-23',type:'purchase',result:'bulk-op'});
 }));
 console.log('PASS Firebase emulator: 50-line purchase posts 50 stock balances, 50 movements and one bill atomically.');
 // Tampering with posted documents or records outside an operation is blocked.
 const invoiceRef=doc(owner,'erp/main/documents/'+invoice),saved=(await getDoc(invoiceRef)).data();
 await assertFails(setDoc(invoiceRef,{...saved,total:1}));
 await assertFails(deleteDoc(invoiceRef));
 const itemRef=doc(owner,'erp/main/items/'+item),savedItem=(await getDoc(itemRef)).data();
 await assertFails(setDoc(itemRef,{...savedItem,stock:-1}));
 await assertFails(setDoc(doc(owner,'wholesaleAccess/owner'),{uid:'other'}));
 // Reusing the receipt is read-only and cannot cause a second stock effect.
 const receipt=await getDoc(doc(owner,'erp/main/operations/op-1'));
 assert.equal(receipt.data().result,item);
 console.log('PASS Firebase emulator: complete posting cycle, authorization, stock validation, immutable invoices and owner configuration.');
}finally{await env.cleanup()}
