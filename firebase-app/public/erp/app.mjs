import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut,sendPasswordResetEmail} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,collection,doc,getDocsFromServer,runTransaction} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {apply,collections,empty,cash,unitList,stockLabel,outstanding,billBalance,openBills,dayReport,orderRemaining} from './core.mjs';
const view=document.querySelector('#view'),message=document.querySelector('#message'),editor=document.querySelector('#editor');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format((value||0)/100);
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let state=empty(),page='Today',mode='',selected='',rows=[],packs=[],busy=false,pending=null,area='',reportDate=date();
let partyRole='Customer';
const config=await (await fetch('/__/firebase/init.json')).json();
const app=initializeApp(config),auth=getAuth(app),db=getFirestore(app),root=doc(db,'erp','main');
const ref=(kind,id)=>doc(collection(root,kind),id);
const pages=['Today','Items','Parties','Purchases','Sales','Orders','Money','Returns','Areas','Reports','Settings','More'];
const find=(kind,id)=>state[kind].find(row=>row.id===id);
const field=(label,name,value='',type='text',extra='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+escape(value)+'" '+extra+'></label>';
const amount=(label,name,value=0)=>field(label,name,(value/100).toFixed(2),'number','min="0" max="1000000000" step=".01" required');
const pick=(label,name,options,current='')=>'<label>'+label+'<select name="'+name+'">'+options.map(([id,label])=>'<option value="'+escape(id)+'"'+(id===current?' selected':'')+'>'+escape(label)+'</option>').join('')+'</select></label>';
const options=(kind,role)=>[['','Select '+(role||kind)],...state[kind].filter(row=>!role||row.role===role).map(row=>[row.id,row.name+(row.role?' · '+row.role:'')+(row.area?' · '+row.area:'')+(row.address?' · '+row.address:'')])];
const methods=()=>pick('Payment method','method',['Cash','UPI','Bank','Card'].map(value=>[value,value]));
const button=(label,action,id='',primary=false)=>'<button type="button" data-action="'+action+'" data-id="'+escape(id)+'"'+(primary?' class="primary"':'')+'>'+label+'</button>';
const table=(headers,body)=>body.length?'<div class="scroll"><table><thead><tr>'+headers.map(label=>'<th>'+escape(label)+'</th>').join('')+'</tr></thead><tbody>'+body.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p class="empty">No records yet.</p>';
const formEnd=label=>'<div class="actions">'+button('Cancel','cancel')+'<button class="primary">'+label+'</button></div></form>';
const status=error=>{message.textContent=error?.message||String(error);message.scrollIntoView({block:'nearest'})};
async function load(){
  const docs=await Promise.all(collections.map(kind=>getDocsFromServer(collection(root,kind))));
  state=empty();
  docs.forEach((snapshot,index)=>state[collections[index]]=snapshot.docs.map(doc=>({...doc.data(),id:doc.id})));
  document.querySelector('#brand').textContent=find('settings','shop')?.name||'Dheeraj Wholesale';
}
function assertUnchanged(snapshot,previous){
  if(snapshot.exists()!==!!previous||(snapshot.data()?.version||0)!==(previous?.version||0))throw Error('Records changed on another device. Refresh and review before saving.');
}
async function save(command,businessDate=date()){
  if(busy)throw Error('A save is already running.');
  const key=JSON.stringify({command,businessDate});
  if(pending&&pending.key!==key)throw Error('Retry the previous action or refresh and check its result first.');
  const attempt=pending||{id:crypto.randomUUID(),key};
  const id=attempt.id,actor=auth.currentUser.uid;
  // Pure command execution means a failed validation cannot change visible stock or dues.
  const proposed=apply(state,command,{id,date:businessDate,actor});
  pending=attempt;
  busy=true;setBusy();
  try{
    const receipt=ref('operations',id);
    await runTransaction(db,async tx=>{
      if((await tx.get(receipt)).exists())return;
      // Read the version of every source used by the command. This pilot chooses
      // conservative consistency over concurrent posting throughput.
      const sources=collections.flatMap(kind=>state[kind].map(row=>({kind,row})));
      const paths=new Map(sources.map(source=>[source.kind+'/'+source.row.id,source]));
      for(const write of proposed.writes)if(!paths.has(write.kind+'/'+write.row.id))paths.set(write.kind+'/'+write.row.id,{kind:write.kind,row:null,id:write.row.id});
      const reads=await Promise.all([...paths.values()].map(source=>tx.get(ref(source.kind,source.row?.id||source.id))));
      [...paths.values()].forEach((source,index)=>assertUnchanged(reads[index],source.row));
      // A generation document catches newly inserted records absent from this screen.
      const generationRef=ref('control','generation'),generation=await tx.get(generationRef);
      if((generation.data()?.value||0)!==generationValue)throw Error('New records were saved elsewhere. Refresh and review.');
      for(const write of proposed.writes){
        const old=find(write.kind,write.row.id);
        tx.set(ref(write.kind,write.row.id),{...write.row,version:(old?.version||0)+1,operationId:id});
      }
      tx.set(generationRef,{value:generationValue+1,operationId:id});
      tx.set(receipt,{actor,date:businessDate,type:command.type,result:proposed.result});
    });
    pending=null;
    await reload();return proposed.result;
  }finally{busy=false;setBusy()}
}
let generationValue=0;
async function reload(){
  // Generation before and after avoids rendering a mixture of two committed workspaces.
  for(let attempt=0;attempt<4;attempt++){
    const {getDocFromServer}=await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
    const before=(await getDocFromServer(ref('control','generation'))).data()?.value||0;
    await load();
    const after=(await getDocFromServer(ref('control','generation'))).data()?.value||0;
    if(before===after){generationValue=after;return}
  }
  throw Error('Records are changing. Refresh again.');
}
function setBusy(){for(const button of document.querySelectorAll('button'))button.disabled=busy}
function go(next){
  if(mode&& !confirm('Leave this form? Unsaved changes will be discarded.'))return;
  page=next;mode='';selected='';rows=[];packs=[];message.textContent='';render();
}
function listDocs(types){
  return state.documents.filter(row=>types.includes(row.type)).sort((a,b)=>b.date.localeCompare(a.date));
}
function docTable(docs){
  return table(['Date','Reference','Party / description','Type','Amount','Outstanding',''],docs.map(doc=>[
    escape(doc.date),escape(doc.reference||doc.code||doc.id.slice(0,8)),escape(doc.partyName),escape(typeName(doc.type)),money(doc.total),
    ['sale','purchase','openingDue'].includes(doc.type)?money(billBalance(state,doc.id)):'—',button('Open','document',doc.id)
  ]));
}
const pageNames={Today:'Today',Orders:'Orders',Items:'Stock & items',Parties:'Customers & suppliers',More:'More'};
const typeName=type=>({sale:'Sale bill',purchase:'Purchase bill',receipt:'Customer collection',payment:'Supplier payment',expense:'Expense',openingDue:'Opening balance',openingStock:'Opening stock',customerReturn:'Customer return',supplierReturn:'Supplier return'}[type]||type);
function render(){
  const mainPages=['Today','Orders','Items','Parties','More'];
  const active=mainPages.includes(page)?page:'More';
  document.querySelector('#nav').innerHTML=mainPages.map(name=>'<button data-page="'+name+'" class="'+(active===name?'active':'')+'"'+(active===name?' aria-current="page"':'')+'>'+escape(pageNames[name])+'</button>').join('');
  let html='<div class="row between page-heading"><h1>'+escape(pageNames[page]||page)+'</h1><div class="row no-print">'+button('Refresh','refresh')+'</div></div>';
  if(page==='More'){
    const links=[['Purchases','Stock received','Enter supplier bills and view purchases.'],['Sales','Sale bills','Create, open and print customer bills.'],['Money','Collections & expenses','Record money received, payments and shop costs.'],['Returns','Returns','Customer returns and goods sent back to suppliers.'],['Areas','Area visits','Plan visits, pending deliveries and collections.'],['Reports','Daily reports','Review sales, stock margins and saved closings.'],['Settings','Shop settings','Business details, invoice images and backup.']];
    html+='<div class="menu-grid">'+links.map(([target,title,description])=>'<button class="menu-tile" data-page="'+target+'"><strong>'+title+'</strong><span>'+description+'</span></button>').join('')+'</div>';
  }
  if(mode==='document'){view.innerHTML=html+documentView(find('documents',selected));setBusy();return}
  if(page==='Today'){
    const hasSupplier=state.parties.some(row=>row.role==='Supplier'),hasCustomer=state.parties.some(row=>row.role==='Customer');
    if(!state.items.length||!hasSupplier||!hasCustomer||!state.movements.length){
      html+='<section class="setup panel"><h2>Set up your shop</h2><p>Start with one real item and the people you buy from and sell to.</p><ol>'+
        [[state.items.length>0,'Add an item','Enter its name, packing and prices.','newItem'],
         [hasSupplier,'Add a supplier','Who delivers stock to your shop?','newSupplier'],
         [hasCustomer,'Add a customer','Which shop do you supply?','newCustomer'],
         [state.movements.length>0,'Enter your stock','Record a supplier delivery or opening stock.','newPurchase']].map(([done,title,description,action])=>
          '<li><div><strong>'+title+'</strong><small>'+description+'</small></div>'+button(done?'Add another':title,action)+'</li>').join('')+'</ol></section>';
    }

    const report=dayReport(state,date()),pendingOrders=state.orders.filter(order=>orderRemaining(order).some(row=>row.remaining>0));
    html+='<div class="daily-actions">'+button('New sale','newSale','',true)+button('Receive stock','newPurchase')+button('Take order','newOrder')+'</div><div class="metrics">'+
      [['Sales today',report.sales],['Received today',report.methods.reduce((n,row)=>n+row.received,0)],['Expenses today',report.expenses],
       ['Customers owe',state.parties.filter(p=>p.role==='Customer').reduce((n,p)=>n+outstanding(state,p.id),0)]].map(([label,value])=>'<div class="metric">'+label+'<strong>'+money(value)+'</strong></div>').join('')+'</div>'+
      '<section class="panel"><h2>Orders still to send · '+pendingOrders.length+'</h2>'+table(['Party','Area','Pending',''],pendingOrders.map(order=>[escape(order.partyName),escape(order.area),orderRemaining(order).filter(line=>line.remaining).map(line=>escape(line.name)+' · '+line.remaining+' '+escape(find('items',line.itemId)?.unit||'units')).join('<br>'),button('Open order','order',order.id)]))+'</section>'+
      '<section class="panel"><h2>Deliveries in progress</h2>'+docTable(state.documents.filter(doc=>doc.delivery==='Out for delivery'))+'</section>'+
      '<details class="panel"><summary>Cash, UPI and bank totals</summary>'+table(['Method','Received','Paid out'],report.methods.map(row=>[row.method,money(row.received),money(row.paid)]))+'</details><section class="panel close-day"><div><h2>Finish the day</h2><p>Check drawer cash and save today’s report.</p></div>'+button('Close day','close','',true)+'</section>';
    if(mode==='closing')html+=closingForm();
  }
  if(page==='Items'){
    if(mode==='item')html+=itemForm();
    else if(mode==='stock')html+=stockForm();
    else html+=button('Add item','newItem','',true)+table(['Item','Packing','Stock','MRP / unit','Selling / unit',''],state.items.map(item=>[
      escape(item.name),escape(unitList(item).map(unit=>'1 '+unit.name+' = '+unit.factor+' '+item.unit).join(' · ')),escape(stockLabel(item)),money(item.mrp),money(item.price),
      button('Edit','editItem',item.id)+button('Opening stock','stock',item.id)+button('Movements','movements',item.id)
    ]));
    if(mode==='movements')html+='<section class="panel"><h2>Stock movement history</h2>'+table(['Date','Item','Quantity in base units','Source'],state.movements.filter(row=>row.itemId===selected).map(row=>[escape(row.date),escape(row.itemName),String(row.quantity),button('Open','document',row.source)]))+'</section>';
  }
  if(page==='Parties'){
    if(mode==='party')html+=partyForm();
    else if(mode==='ledger')html+=ledgerView();
    else if(mode==='price')html+=priceForm();
    else html+=button('Add customer or supplier','newParty','',true)+table(['Name','Type','Area','Address','Outstanding',''],state.parties.map(party=>[
      escape(party.name),party.role,escape(party.area),escape(party.address),money(outstanding(state,party.id)),
      button('Edit','editParty',party.id)+button('Ledger','ledger',party.id)+(party.role==='Customer'?button('Prices','price',party.id):'')
    ]));
  }
  if(['Purchases','Sales','Orders'].includes(page)){
    if(mode==='bill')html+=billForm();
    else if(mode==='order')html+=orderView();
    else{
      html+=button(page==='Purchases'?'Receive stock':page==='Sales'?'New sale':'Take order',page==='Purchases'?'newPurchase':page==='Sales'?'newSale':'newOrder','',true);
      if(page==='Orders')html+=table(['Date','Customer','Area','Status',''],state.orders.map(order=>[escape(order.date),escape(order.partyName),escape(order.area),orderRemaining(order).some(row=>row.remaining)?'Still to send':'Fully dispatched',button('Open','order',order.id)]));
      else html+=docTable(listDocs([page==='Purchases'?'purchase':'sale']));
    }
  }
  if(page==='Money'){
    html+='<form data-form="money"><h2>Record money</h2><div class="fields">'+pick('What happened?','type',[['receipt','Collected from customer'],['payment','Paid supplier'],['openingDue','Opening party balance'],['expense','Shop expense']])+
      pick('Party (for collections, payments or opening dues)','partyId',options('parties'))+field('Date','date',date(),'date','required')+amount('Amount ₹','amount')+methods()+
      field('Expense description','description')+field('Expense category','category','Other')+field('Area (expense only, optional)','area')+'</div><button class="primary">Save entry</button></form>'+docTable(listDocs(['receipt','payment','expense','openingDue']));
  }
  if(page==='Returns'){
    html+='<form data-form="return"><h2>Customer / supplier return</h2><div class="fields">'+pick('Return direction','type',[['customerReturn','Customer returned goods to us'],['supplierReturn','We returned goods to supplier']])+
      pick('Original bill','sourceId',[['','Select original bill'],...listDocs(['sale','purchase']).map(doc=>[doc.id,doc.type+' · '+doc.partyName+' · '+doc.date+' · '+money(doc.total)])])+
      '<label>Item on bill<select name="lineId"><option value="">Select bill first</option></select></label>'+field('Quantity in original bill unit','quantity',1,'number','min="1" step="1" required')+
      amount('Agreed return value ₹','amount')+pick('Goods condition','condition',[['Sellable','Sellable'],['Unsellable','Damaged / unsellable']])+
      pick('Settlement','settlement',[['Credit','Reduce outstanding bills'],['Refund','Money refunded now']])+methods()+field('Date','date',date(),'date','required')+'</div><button class="primary">Save return</button></form>'+docTable(listDocs(['customerReturn','supplierReturn']));
  }
  if(page==='Areas')html+=areasView();
  if(page==='Reports')html+=reportsView();
  if(page==='Settings')html+=settingsForm();
  view.innerHTML=html;
  if(mode==='bill'){restoreDraft();renderRows()}
  if(mode==='item'){renderPacks();updatePackLabels()}
  if(mode==='order')renderDispatch();
  if(page==='Money')updateMoneyForm();
  if(page==='Returns')updateReturnForm();
  if(mode==='party')updatePartyForm();
  setBusy();
}
function updatePartyForm(){
 const form=view.querySelector('[data-form=party]');
 if(!form)return;
 const customer=form.elements.role.value==='Customer';
 form.elements.area.closest('label').hidden=!customer;
 form.elements.area.required=customer;
}
function updateMoneyForm(){
 const form=view.querySelector('[data-form=money]');
 if(!form)return;
 const kind=form.elements.type.value,expense=kind==='expense';
 for(const name of ['description','category','area']){
   form.elements[name].closest('label').hidden=!expense;
   form.elements[name].required=expense&&name!=='area';
 }
 form.elements.partyId.closest('label').hidden=expense;
 form.elements.partyId.required=!expense;
 const role=kind==='receipt'?'Customer':kind==='payment'?'Supplier':null;
 const previous=form.elements.partyId.value;
 form.elements.partyId.innerHTML=options('parties',role).map(([id,label])=>'<option value="'+escape(id)+'">'+escape(label)+'</option>').join('');
 if([...form.elements.partyId.options].some(option=>option.value===previous))form.elements.partyId.value=previous;
 form.elements.method.closest('label').hidden=kind==='openingDue';
 form.elements.amount.min='.01';
}
function updateReturnForm(){
 const form=view.querySelector('[data-form=return]');
 if(!form)return;
 const customer=form.elements.type.value==='customerReturn',previous=form.elements.sourceId.value;
 form.elements.sourceId.innerHTML=[['','Select original '+(customer?'sale':'purchase')+' bill'],...listDocs([customer?'sale':'purchase']).map(doc=>[doc.id,doc.partyName+' · '+doc.date+' · '+money(doc.total)])]
   .map(([id,label])=>'<option value="'+escape(id)+'">'+escape(label)+'</option>').join('');
 if([...form.elements.sourceId.options].some(option=>option.value===previous))form.elements.sourceId.value=previous;
 form.elements.condition.closest('label').hidden=!customer;
 form.elements.method.closest('label').hidden=form.elements.settlement.value!=='Refund';
 const bill=find('documents',form.elements.sourceId.value),selectedLine=form.elements.lineId.value;
 form.elements.lineId.innerHTML=(bill?.lines||[]).map(line=>'<option value="'+line.id+'">'+escape(line.name)+' · '+escape(line.unit)+'</option>').join('');
 if([...form.elements.lineId.options].some(option=>option.value===selectedLine))form.elements.lineId.value=selectedLine;
 form.elements.sourceId.required=true;
 form.elements.lineId.required=true;
}
function itemForm(){
  const item=find('items',selected);
  return '<form data-form="item"><h2>'+ (item?'Edit item':'Add item')+'</h2><section><h2>Item details</h2><div class="fields">'+
    field('Item name, flavour and size','name',item?.name||'','text','required')+field('Unit (pouch, bottle, piece)','unit',item?.unit||'','text','required')+
    field('Barcode (optional)','barcode',item?.barcode||'')+'</div></section><section><h2>Packing (optional)</h2><p class="muted">Each pack contains the unit in the row above.</p><div id="packs"></div>'+button('Add pack','pack')+'</section>'+
    '<section><h2>Prices</h2><div class="fields">'+amount('MRP per individual unit ₹','mrp',item?.mrp||0)+amount('Selling price per individual unit ₹','price',item?.price||0)+'</div><p class="muted">Enter a selling price beside each pack in the packing table.</p></section>'+
    '<section><h2>Tax details</h2><div class="fields">'+field('HSN','hsn',item?.hsn||'')+field('GST %','tax',item?.tax||0,'number','min="0" max="100" step=".01" required')+'</div></section>'+formEnd('Save item');
}
function renderPacks(){
  const form=view.querySelector('[data-form=item]'),unit=form.elements.unit.value||'item unit';
  let lower=unit;
  document.querySelector('#packs').innerHTML=table(['Pack name','Contains','Unit','Selling price / pack ₹',''],packs.map((pack,index)=>{
    const previous=lower;lower=pack.name||'previous pack';
    return ['<input aria-label="Pack name" data-pack="'+index+'" data-field="name" value="'+escape(pack.name)+'" required>',
      '<input aria-label="Contains" data-pack="'+index+'" data-field="contains" type="number" min="2" step="1" value="'+pack.contains+'" required>','<span data-pack-lower="'+index+'">'+escape(previous)+'</span>',
      '<input aria-label="Pack selling price" data-pack="'+index+'" data-field="price" type="number" min="0" step=".01" value="'+(pack.price/100).toFixed(2)+'" required>',button('Remove','removePack',String(index))];
  }));
}
function updatePackLabels(){
  const form=view.querySelector('[data-form=item]');
  if(!form)return;
  const unit=form.elements.unit.value.trim()||'individual unit';
  let lower=unit;
  for(const [index,pack]of packs.entries()){
    const output=view.querySelector('[data-pack-lower="'+index+'"]');
    if(output)output.textContent=lower;
    lower=pack.name||'previous pack';
  }
  form.elements.mrp.closest('label').firstChild.textContent='MRP per '+unit+' ₹';
  form.elements.price.closest('label').firstChild.textContent='Selling price per '+unit+' ₹';
}
function partyForm(){
  const party=find('parties',selected);
  const areas=[...new Set(state.parties.map(row=>row.area).filter(Boolean))];
  return '<form data-form="party"><h2>'+(party?'Edit profile':'Add customer or supplier')+'</h2><div class="fields">'+
    pick('Type','role',[['Customer','Customer'],['Supplier','Supplier']],party?.role||partyRole)+field('Name','name',party?.name||'','text','required')+
    field('Delivery / business address','address',party?.address||'','text','required')+field('Area (customers)','area',party?.area||'','text','list="area-names"')+
    field('Mobile','mobile',party?.mobile||'','tel')+field('GSTIN (optional)','gstin',party?.gstin||'')+'</div><datalist id="area-names">'+areas.map(name=>'<option value="'+escape(name)+'">').join('')+'</datalist>'+formEnd('Save profile');
}
function stockForm(){
  const item=find('items',selected);
  return '<form data-form="stock"><h2>Opening stock · '+escape(item.name)+'</h2><p>Use this for stock already in the shop when starting the system. Use Purchases for new deliveries.</p><div class="fields">'+
    pick('Unit','unit',unitList(item).map(unit=>[unit.name,unit.name]))+field('Quantity','quantity',1,'number','min="1" step="1" required')+
    amount('Cost per selected unit before GST ₹','cost')+field('Date','date',date(),'date','required')+'</div>'+formEnd('Save opening stock');
}
function priceForm(){
  const party=find('parties',selected);
  return '<form data-form="price"><h2>Agreed prices · '+escape(party.name)+'</h2><div class="fields">'+
    pick('Item','itemId',options('items'))+'<label>Unit<select name="unit"></select></label>'+amount('Selling price for this unit ₹','rate')+'</div><button class="primary">Save agreed price</button></form>'+
    table(['Item','Unit','Agreed price'],party.prices.map(row=>[escape(find('items',row.itemId)?.name),escape(row.unit),money(row.rate)]));
}
function ledgerView(){
  const party=find('parties',selected);let running=0;
  const entries=state.documents.filter(doc=>doc.partyId===party.id).sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||'').localeCompare(b.createdAt||'')||a.id.localeCompare(b.id));
  return '<section class="panel"><h2>'+escape(party.name)+' · '+money(outstanding(state,party.id))+' outstanding</h2>'+
    table(['Date','Transaction','Increase','Decrease','Balance',''],entries.map(doc=>{
      running+=doc.dueDelta||0;
      return [escape(doc.date),escape(doc.type),doc.dueDelta>0?money(doc.dueDelta):'—',doc.dueDelta<0?money(-doc.dueDelta):'—',money(running),button('Open','document',doc.id)];
    }))+'</section><form data-form="collect"><h2>'+(party.role==='Customer'?'Collect payment':'Pay supplier')+'</h2><div class="fields">'+
    pick('Allocate payment','billId',[['','Oldest outstanding bills first'],...openBills(state,party.id).map(doc=>[doc.id,doc.date+' · '+money(doc.balance)+' due'])])+
    amount('Amount ₹','amount')+methods()+field('Date','date',date(),'date','required')+'</div><button class="primary">Save payment</button></form>';
}
let billType='sale',draft={};
function rememberDraft(){const form=view.querySelector('[data-form=bill]');if(form)draft=Object.fromEntries(new FormData(form))}
function restoreDraft(){const form=view.querySelector('[data-form=bill]');for(const [name,value]of Object.entries(draft)){if(form.elements[name])form.elements[name].value=value}}
function billForm(){
  const purchase=billType==='purchase',order=billType==='order';
  return '<form data-form="bill"><h2>'+(purchase?'Receive stock':order?'Customer order':'Sale bill')+'</h2><div class="fields">'+
    pick(purchase?'Supplier':'Customer','partyId',options('parties',purchase?'Supplier':'Customer'),draft.partyId||'')+
    field('Date','date',draft.date||date(),'date','required')+(purchase?field('Supplier invoice number','reference',draft.reference||'','text','required'):'')+'</div>'+
    '<div id="bill-rows"></div>'+button('Add item row','addRow')+'<div class="totals" id="totals"></div>'+
    (order?'':'<div class="fields">'+pick(purchase?'Payment to supplier':'Customer payment','settlement',[['credit','On credit'],['full','Paid in full'],['partial','Part paid']],draft.settlement||'credit')+
      amount('Part payment ₹','paid',cash(draft.paid||0))+methods()+'</div>')+
    '<p class="muted">Enter the rate for the selected unit, before GST.</p>'+formEnd(order?'Save order':purchase?'Save purchase':'Save sale');
}
function rowFields(row,index){
  const item=find('items',row.itemId),units=item?unitList(item):[];
  const totals=lineTotal(row);
  return [
    '<select data-row="'+index+'" data-field="itemId" aria-label="Item">'+options('items').map(([id,name])=>'<option value="'+escape(id)+'"'+(row.itemId===id?' selected':'')+'>'+escape(name)+'</option>').join('')+'</select>',
    item?escape(stockLabel(item)):'—',
    '<input data-row="'+index+'" data-field="quantity" type="number" aria-label="Quantity" min="1" step="1" value="'+row.quantity+'" required>',
    '<select data-row="'+index+'" data-field="unit" aria-label="Unit">'+units.map(unit=>'<option'+(unit.name===row.unit?' selected':'')+'>'+escape(unit.name)+'</option>').join('')+'</select>',
    ...(billType==='purchase'?['<input data-row="'+index+'" data-field="free" type="number" aria-label="Free quantity" min="0" step="1" value="'+(row.free||0)+'">']:[]),
    '<input data-row="'+index+'" data-field="rate" type="number" aria-label="Rate per selected unit" min="0" step=".01" value="'+(row.rate/100).toFixed(2)+'" required>',
    '<input data-row="'+index+'" data-field="discount" type="number" aria-label="Discount percent" min="0" max="100" step=".01" value="'+(row.discount||0)+'">',
    item?item.tax+'%':'—','<span data-line-total="'+index+'">'+money(totals.total)+'</span>',
    button('Edit','editRow',String(index))+button('Remove','removeRow',String(index))
  ];
}
function lineTotal(row){
  const item=find('items',row.itemId);
  const base=Math.round((Number(row.quantity)||0)*(Number(row.rate)||0)*(1-(Number(row.discount)||0)/100));
  const tax=Math.round(base*(item?.tax||0)/100);
  return {base,tax,total:base+tax};
}
function renderRows(){
  if(window.matchMedia('(max-width:700px)').matches){
    document.querySelector('#bill-rows').innerHTML=table(['Item','Quantity','Total',''],rows.map((row,index)=>[
      escape(find('items',row.itemId)?.name||'Choose item'),escape(row.quantity+' '+row.unit),money(lineTotal(row).total),
      button('Edit','editRow',String(index))+button('Remove','removeRow',String(index))
    ]));
    updateTotals();return;
  }
  document.querySelector('#bill-rows').innerHTML='<div class="bill">'+table(['Item','Stock','Quantity','Unit',...(billType==='purchase'?['Free']:[]),'Rate / unit ₹','Disc %','GST','Amount ₹',''],rows.map(rowFields))+'</div>';
  updateTotals();
}
function updateTotals(){
  const sums=rows.map(lineTotal).reduce((a,b)=>({base:a.base+b.base,tax:a.tax+b.tax,total:a.total+b.total}),{base:0,tax:0,total:0});
  document.querySelector('#totals').innerHTML='<p><span>Before GST</span><strong>'+money(sums.base)+'</strong></p><p><span>GST</span><strong>'+money(sums.tax)+'</strong></p><p><span>Total</span><strong>'+money(sums.total)+'</strong></p>';
  rows.forEach((row,index)=>{const output=view.querySelector('[data-line-total="'+index+'"]');if(output)output.textContent=money(lineTotal(row).total)});
  const form=view.querySelector('[data-form=bill]');
  if(form?.elements.settlement)form.elements.paid.closest('label').hidden=form.elements.settlement.value!=='partial';
}
function setDefaultRate(row){
  const item=find('items',row.itemId);if(!item)return;
  const unit=unitList(item).find(unit=>unit.name===row.unit)||unitList(item)[0];
  row.unit=unit.name;
  const party=find('parties',draft.partyId);
  row.rate=billType==='purchase'?Math.round(item.cost*unit.factor):
    party?.prices.find(price=>price.itemId===item.id&&price.unit===unit.name)?.rate??unit.price;
}
function orderView(){
  const order=find('orders',selected),remaining=orderRemaining(order);
  return '<section class="panel"><h2>'+escape(order.partyName)+'</h2><p>'+escape(order.address)+' · '+escape(order.area)+'</p>'+
    table(['Item','Ordered','Sent','Still to send','Stock now'],remaining.map(line=>[escape(line.name),line.quantity+' '+escape(line.unit),String(line.sent)+' '+escape(find('items',line.itemId)?.unit),String(line.remaining)+' '+escape(find('items',line.itemId)?.unit),escape(stockLabel(find('items',line.itemId)))]))+'</section>'+
    '<form data-form="dispatch"><h2>Dispatch available goods and create bill</h2><div id="dispatch-rows"></div><div class="fields">'+amount('Amount received ₹','paid')+methods()+field('Dispatch date','date',date(),'date','required')+'</div><button class="primary">Save dispatch and invoice</button></form>'+
    '<section class="panel"><h2>Dispatch history</h2>'+docTable(state.documents.filter(doc=>doc.orderId===order.id))+'</section>';
}
function renderDispatch(){
  const order=find('orders',selected);
  document.querySelector('#dispatch-rows').innerHTML=table(['Item','Send in','Pending base units','Available base units','Send now','Rate per selected unit ₹'],orderRemaining(order).map(line=>[
    escape(line.name),
    '<select name="unit-'+line.id+'" data-dispatch-unit="'+line.id+'" aria-label="Dispatch unit">'+unitList(find('items',line.itemId)).map(unit=>'<option'+(unit.name===line.unit?' selected':'')+'>'+escape(unit.name)+'</option>').join('')+'</select>',
    String(line.remaining)+' '+escape(find('items',line.itemId).unit),String(find('items',line.itemId).stock),
    '<input name="send-'+line.id+'" type="number" min="0" step="1" value="0" aria-label="Send '+escape(line.name)+'">',
    '<input name="rate-'+line.id+'" type="number" min="0" step=".01" value="'+(line.rate/100).toFixed(2)+'" aria-label="Dispatch selling rate">'
  ]));
}
function closingForm(){
  return '<form data-form="closing"><h2>Close day</h2><div class="fields">'+field('Business date','date',date(),'date','required')+
    amount('Opening drawer cash ₹','opening')+amount('Counted drawer cash ₹','counted')+field('Notes','note')+'</div><p class="muted">The saved closing contains totals for this date at the time you close it.</p>'+formEnd('Save closing report');
}
function areasView(){
  const areas=[...new Set([...state.parties.map(row=>row.area),...state.orders.map(row=>row.area)].filter(Boolean))].sort();
  const orders=state.orders.filter(order=>(!area||order.area===area)&&orderRemaining(order).some(row=>row.remaining));
  const parties=state.parties.filter(row=>row.role==='Customer'&&(!area||row.area===area));
  return '<section class="panel">'+pick('Area','areaFilter',[['','All areas'],...areas.map(name=>[name,name])],area)+'</section>'+
    '<section class="panel"><h2>Goods still to send</h2>'+table(['Customer','Area','Pending',''],orders.map(order=>[escape(order.partyName),escape(order.area),
      orderRemaining(order).filter(row=>row.remaining).map(row=>escape(row.name)+' · '+row.remaining+' '+escape(find('items',row.itemId)?.unit||'units')).join('<br>'),button('Open order','order',order.id)]))+'</section>'+
    '<section class="panel"><h2>Collections</h2>'+table(['Customer','Area','Due',''],parties.filter(p=>outstanding(state,p.id)>0).map(p=>[escape(p.name),escape(p.area),money(outstanding(state,p.id)),button('Ledger / collect','ledger',p.id)]))+'</section>'+
    '<form data-form="visit"><h2>Plan a visit</h2><div class="fields">'+pick('Area','area',areas.map(name=>[name,name]),area)+field('Visit date','date',date(),'date','required')+field('Tasks / shops to visit','note','','text','required')+'</div><button class="primary">Save visit</button></form>'+
    table(['Date','Area','Plan','Status'],state.visits.filter(v=>!area||v.area===area).map(v=>[escape(v.date),escape(v.area),escape(v.note),v.done?'Completed':button('Mark completed','visitDone',v.id)]));
}
function reportsView(){
  const docs=state.documents.filter(doc=>doc.date===reportDate),report=dayReport(state,reportDate);
  const performance=new Map();
  for(const doc of docs.filter(doc=>doc.type==='sale'))for(const line of doc.lines||[]){
    const key=(doc.area||'Unassigned')+'|'+line.itemId;
    const row=performance.get(key)||{area:doc.area||'Unassigned',name:line.name,units:0,base:0,cost:0};
    row.units+=line.baseQuantity;row.base+=line.base;row.cost+=line.cost||0;performance.set(key,row);
  }
  return '<section class="panel">'+field('Report date','reportDate',reportDate,'date')+'</section>'+
    '<section class="panel"><h2>Day totals</h2>'+table(['Sales','Purchases','Expenses','Customer returns','Supplier returns'],[[money(report.sales),money(report.purchases),money(report.expenses),money(report.customerReturns),money(report.supplierReturns)]] )+'</section>'+
    '<section class="panel"><h2>Area / item sales and gross margin</h2><p class="muted">Before return adjustments and expenses. Units are individual stock units.</p>'+table(['Area','Item','Units sold','Sales before GST','Cost','Gross margin'],[...performance.values()].sort((a,b)=>b.units-a.units).map(row=>[escape(row.area),escape(row.name),String(row.units),money(row.base),money(row.cost),money(row.base-row.cost)]))+'</section>'+
    '<section class="panel"><h2>Transactions behind these totals</h2>'+docTable(docs)+'</section>'+
    '<section class="panel"><h2>Saved closings</h2>'+table(['Date','Expected cash','Counted cash','Difference','Sales','Notes'],state.closings.map(row=>[escape(row.date),money(row.expected),money(row.counted),money(row.difference),money(row.report.sales),escape(row.note)]))+'</section>';
}
function settingsForm(){
  const shop=find('settings','shop')||{};
  return '<form data-form="settings"><h2>Shop and invoice details</h2><div class="fields">'+field('Shop name','name',shop.name||'Dheeraj Wholesale','text','required')+
    field('Address','address',shop.address||'','text','required')+field('GSTIN','gstin',shop.gstin||'')+field('Phone','phone',shop.phone||'')+
    field('Logo image (optional, up to 60 KB)','logo','','file','accept="image/png,image/jpeg,image/webp"')+
    field('Signature image (optional, up to 60 KB)','signature','','file','accept="image/png,image/jpeg,image/webp"')+'</div><p class="muted">Use cropped PNG or JPG images. This stores a signature image, not a certificate-based digital signature.</p><button class="primary">Save shop details</button></form>'+
    '<section class="panel"><h2>Workspace and data</h2><p>This rebuild uses a separate Firestore workspace. Earlier app records remain in the original app. Import and migration require review.</p>'+button('Download complete ERP export','export')+'</section>';
}
function documentView(doc){
  if(!doc)return '<p>Document unavailable.</p>';
  const party=find('parties',doc.partyId),shop=doc.shop||find('settings','shop')||{name:'Dheeraj Wholesale'};
  const bill=['sale','purchase'].includes(doc.type),isSale=doc.type==='sale';
  return '<article class="invoice panel"><header><div>'+(shop.logo?'<img class="brand-image" src="'+escape(shop.logo)+'" alt="Shop logo">':'')+'<h2>'+escape(shop.name)+'</h2><p>'+escape(shop.address||'')+'</p><p>GSTIN '+escape(shop.gstin||'—')+'</p></div><div><h2>'+escape(doc.type==='sale'?'Sales invoice':doc.type==='purchase'?'Purchase bill':doc.type)+'</h2><p>Ref '+escape(doc.reference||doc.code||doc.id)+'</p><p>'+escape(doc.date)+'</p></div></header>'+
    '<p><strong>'+escape(doc.partyName)+'</strong><br>'+escape(doc.address||'')+(doc.area?'<br>'+escape(doc.area):'')+'</p>'+
    (doc.lines?table(['Item','HSN','Quantity','Unit','Free','Rate ₹','Before GST ₹','GST ₹','Total ₹'],doc.lines.map(line=>[escape(line.name),escape(line.hsn||''),String(line.quantity),escape(line.unit),String(line.free||0),money(line.rate),money(line.base),money(line.tax),money(line.total)])):'')+
    '<div class="totals"><p><strong>Total</strong><strong>'+money(doc.total)+'</strong></p>'+(bill?'<p><span>Outstanding</span><strong>'+money(billBalance(state,doc.id))+'</strong></p>':'')+'</div>'+
    '<footer>'+(shop.signature?'<img class="signature" src="'+escape(shop.signature)+'" alt="Authorized signature">':'')+'<p>Authorized signatory</p></footer>'+
    '<p class="muted">Test invoice format. GST configuration and invoice numbering series require validation before live billing.</p>'+
    '<div class="row no-print">'+button('Back','cancel')+button('Print / save PDF','print')+
    (doc.delivery==='Out for delivery'?button('Mark delivered','delivered',doc.id):'')+
    (party?button('Party ledger','ledger',party.id):'')+'</div></article>';
}
function loginView(){
  view.innerHTML='<form data-form="login" class="login"><h1>Owner sign-in</h1><div class="fields">'+
    field('Email','email','','email','autocomplete="username" required')+field('Password','password','','password','autocomplete="current-password" required')+
    '</div><button class="primary">Sign in</button>'+button('Reset password','reset')+'</form>';
}
function rowEditor(index){
  const row=rows[index],item=find('items',row.itemId);
  editor.innerHTML='<h2>Edit bill row</h2><form data-form="row" data-index="'+index+'"><div class="fields">'+
    pick('Item','itemId',options('items'),row.itemId)+field('Quantity','quantity',row.quantity,'number','min="1" step="1" required')+
    pick('Unit','unit',item?unitList(item).map(unit=>[unit.name,unit.name]):[],row.unit)+
    (billType==='purchase'?field('Free quantity','free',row.free||0,'number','min="0" step="1"'):'')+
    amount('Rate per selected unit ₹','rate',row.rate)+field('Discount %','discount',row.discount||0,'number','min="0" max="100" step=".01"')+
    '</div><div class="row">'+button('Cancel','closeEditor')+'<button class="primary">Update row</button></div></form>';
  editor.showModal();
}
document.addEventListener('click',async event=>{
  const element=event.target.closest('button');if(!element)return;
  if(busy){status('Saving. Please wait.');return}
  if(element.dataset.page){go(element.dataset.page);return}
  const action=element.dataset.action,id=element.dataset.id;
  if(!action)return;
  try{
    if(action==='cancel'){mode='';selected='';rows=[];draft={};render()}
    if(action==='refresh'){if(mode&&!confirm('Refresh and discard this form?'))return;pending=null;await reload();mode='';render();status('Records refreshed.')}
    if(action==='newItem'||action==='editItem'){page='Items';mode='item';selected=action==='editItem'?id:'';packs=structuredClone(find('items',selected)?.packs||[]);render()}
    if(action==='stock'||action==='movements'){page='Items';mode=action;selected=id;render()}
    if(['newParty','editParty','newSupplier','newCustomer'].includes(action)){page='Parties';mode='party';selected=action==='editParty'?id:'';partyRole=action==='newSupplier'?'Supplier':'Customer';render()}
    if(action==='ledger'||action==='price'){page='Parties';mode=action;selected=id;render()}
    if(action==='pack'){
      const form=view.querySelector('[data-form=item]');
      // Keep the surrounding form in place when adding/removing a packing row.
      if(packs.length>=5)throw Error('This pilot supports up to five packing rows.');
      packs.push({name:'',contains:2,price:0});renderPacks();form.querySelector('[data-pack="'+(packs.length-1)+'"]').focus();
    }
    if(action==='removePack'){packs.splice(Number(id));renderPacks()}
    if(['newSale','newPurchase','newOrder'].includes(action)){
      const role=action==='newPurchase'?'Supplier':'Customer';
      if(!state.items.length){page='Items';mode='item';selected='';packs=[];render();status('Add your first item. Then return to '+(action==='newPurchase'?'Receive stock':action==='newOrder'?'Take order':'New sale')+'.');return}
      if(!state.parties.some(row=>row.role===role)){page='Parties';mode='party';selected='';partyRole=role;render();status('Add a '+role.toLowerCase()+' to continue.');return}

      billType=action==='newSale'?'sale':action==='newPurchase'?'purchase':'order';
      page=billType==='sale'?'Sales':billType==='purchase'?'Purchases':'Orders';
      mode='bill';selected='';draft={};rows=[{itemId:'',quantity:1,unit:'',rate:0,discount:0,free:0}];render();
    }
    if(action==='addRow'){
      rememberDraft();
      if(rows.length>=50)throw Error('This pilot supports up to 50 bill rows.');
      rows.push({itemId:'',quantity:1,unit:'',rate:0,discount:0,free:0});renderRows();if(window.matchMedia('(max-width:700px)').matches)rowEditor(rows.length-1);
    }
    if(action==='removeRow'){rows.splice(Number(id),1);renderRows()}
    if(action==='editRow')rowEditor(Number(id));
    if(action==='closeEditor')editor.close();
    if(action==='order'){page='Orders';selected=id;mode='order';render()}
    if(action==='document'){mode='document';selected=id;render()}
    if(action==='print')window.print();
    if(action==='close'){page='Today';mode='closing';render();view.querySelector('[data-form=closing]').scrollIntoView()}
    if(action==='delivered'){await save({type:'delivered',body:{id}});render();status('Delivery recorded.')}
    if(action==='visitDone'){await save({type:'visitDone',body:{id}});render();status('Visit completed.')}
    if(action==='export'){
      const blob=new Blob([JSON.stringify({schema:1,exportedAt:new Date().toISOString(),state},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='dheeraj-erp-'+date()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    if(action==='reset'){
      const email=view.querySelector('[name=email]').value;
      if(!email)throw Error('Enter your email first.');
      await sendPasswordResetEmail(auth,email);status('Password reset requested. Check your email.');
    }
  }catch(error){status(error)}
});
document.addEventListener('input',event=>{
  const target=event.target;
  if(target.dataset.pack!==undefined){
    const pack=packs[Number(target.dataset.pack)];
    pack[target.dataset.field]=target.dataset.field==='price'?cash(target.value):target.value;
    updatePackLabels();
  }
  if(target.name==='unit'&&target.closest('[data-form=item]'))updatePackLabels();
  if(target.dataset.row!==undefined){
    const row=rows[Number(target.dataset.row)];
    row[target.dataset.field]=target.dataset.field==='rate'?cash(target.value):target.value;
    updateTotals();
  }
});
document.addEventListener('change',event=>{
  const target=event.target;
  if(target.dataset.row!==undefined&&['itemId','unit'].includes(target.dataset.field)){
    const row=rows[Number(target.dataset.row)];row[target.dataset.field]=target.value;
    if(target.dataset.field==='itemId')row.unit=unitList(find('items',row.itemId)||{unit:'',price:0,packs:[]})[0].name;
    rememberDraft();setDefaultRate(row);renderRows();
  }
  const form=target.closest('form');
  if(form?.dataset.form==='money'&&target.name==='type')updateMoneyForm();
  if(form?.dataset.form==='party'&&target.name==='role')updatePartyForm();
  if(form?.dataset.form==='return'&&['type','sourceId','settlement'].includes(target.name))updateReturnForm();
  if(target.dataset.dispatchUnit!==undefined){
    const line=find('orders',selected).lines.find(row=>row.id===target.dataset.dispatchUnit);
    const unit=unitList(find('items',line.itemId)).find(row=>row.name===target.value);
    form.elements['rate-'+line.id].value=(Math.round(line.rate*unit.factor/line.factor)/100).toFixed(2);
  }
  if(form?.dataset.form==='row'&&['itemId','unit'].includes(target.name)){
    const item=find('items',form.elements.itemId.value);
    if(target.name==='itemId')form.elements.unit.innerHTML=(item?unitList(item):[]).map(unit=>'<option>'+escape(unit.name)+'</option>').join('');
    const row={itemId:form.elements.itemId.value,unit:form.elements.unit.value};setDefaultRate(row);
    form.elements.rate.value=((row.rate||0)/100).toFixed(2);
  }
  if(form?.dataset.form==='bill'){
    rememberDraft();
    if(target.name==='partyId'){for(const row of rows)setDefaultRate(row);renderRows()}
    if(target.name==='settlement')updateTotals();
  }
  if(form?.dataset.form==='price'&&target.name==='itemId'){
    const item=find('items',target.value);
    form.elements.unit.innerHTML=(item?unitList(item):[]).map(unit=>'<option>'+escape(unit.name)+'</option>').join('');
  }
  if(form?.dataset.form==='return'&&target.name==='sourceId'){
    const bill=find('documents',target.value);
    form.elements.lineId.innerHTML=(bill?.lines||[]).map(line=>'<option value="'+line.id+'">'+escape(line.name)+' · '+escape(line.unit)+'</option>').join('');
  }
  if(target.name==='areaFilter'){area=target.value;render()}
  if(target.name==='reportDate'){reportDate=target.value;render()}
});
async function imageData(file){
  if(!file?.size)return null;
  if(file.size>60000||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Use a PNG, JPG or WebP image smaller than 60 KB.');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});
}
document.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const form=event.target,kind=form.dataset.form;
  try{
    const fields=Object.fromEntries(new FormData(form)),businessDate=fields.date||date();
    if(kind==='login'){
      busy=true;setBusy();
      try{await signInWithEmailAndPassword(auth,fields.email,fields.password)}finally{busy=false;setBusy()}
      return;
    }
    if(kind==='row'){
      const index=Number(form.dataset.index);
      rows[index]={...rows[index],...fields,rate:cash(fields.rate)};
      editor.close();renderRows();return;
    }
    let command;
    if(kind==='item')command={type:'item',body:{...fields,id:selected,packs:structuredClone(packs),mrp:cash(fields.mrp),price:cash(fields.price)}};
    if(kind==='party')command={type:'party',body:{...fields,id:selected}};
    if(kind==='stock')command={type:'openingStock',body:{...fields,itemId:selected,cost:cash(fields.cost)}};
    if(kind==='price')command={type:'price',body:{...fields,partyId:selected,rate:cash(fields.rate)}};
    if(kind==='bill'){
      const total=rows.reduce((sum,row)=>sum+lineTotal(row).total,0);
      const paid=fields.settlement==='full'?total:fields.settlement==='partial'?cash(fields.paid):0;
      if(fields.settlement==='partial'&&(paid<=0||paid>=total))throw Error('Part payment must be greater than zero and less than the bill total.');
      command={type:billType,body:{...fields,lines:structuredClone(rows),paid}};
    }
    if(kind==='dispatch'){
      const order=find('orders',selected);
      command={type:'dispatch',body:{orderId:selected,lines:order.lines.map(line=>({lineId:line.id,quantity:Number(fields['send-'+line.id]||0),unit:fields['unit-'+line.id],rate:cash(fields['rate-'+line.id])})).filter(line=>line.quantity>0),paid:cash(fields.paid),method:fields.method}};
    }
    if(kind==='money')command={type:fields.type,body:{...fields,amount:cash(fields.amount)}};
    if(kind==='collect')command={type:find('parties',selected).role==='Customer'?'receipt':'payment',body:{...fields,partyId:selected,amount:cash(fields.amount)}};
    if(kind==='return')command={type:fields.type,body:{...fields,amount:cash(fields.amount)}};
    if(kind==='closing')command={type:'closing',body:{...fields,opening:cash(fields.opening),counted:cash(fields.counted)}};
    if(kind==='visit')command={type:'visit',body:fields};
    if(kind==='settings'){
      const old=find('settings','shop')||{};
      command={type:'settings',body:{...fields,logo:await imageData(fields.logo)||old.logo||'',signature:await imageData(fields.signature)||old.signature||''}};
    }
    if(!command)throw Error('Unknown form.');
    const result=await save(command,businessDate);
    if(['bill','dispatch'].includes(kind)&&find('documents',result)){selected=result;mode='document'}
    else{mode='';selected=''}
    rows=[];draft={};render();status('Saved successfully.');
  }catch(error){status(error)}
});
document.querySelector('#logout').addEventListener('click',async()=>{if(!busy)await signOut(auth)});
onAuthStateChanged(auth,async user=>{
  document.querySelector('#logout').hidden=!user;message.textContent='';
  if(!user){state=empty();page='Today';mode='';pending=null;document.querySelector('#nav').innerHTML='';loginView();return}
  view.innerHTML='<p>Loading shop records…</p>';
  try{await reload();render()}catch(error){view.innerHTML='<p>Shop access could not be loaded. Check the owner UID and deploy the ERP rules.</p>';status(error)}
});
