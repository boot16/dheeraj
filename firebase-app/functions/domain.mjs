import { randomUUID } from 'node:crypto';

const crypto = { randomUUID };

export function applyCommand(data, actor, command) {
 let page = command.page;
 let lines = [];
 const save = change => change(data);
 const form = fields => new Map(Object.entries(fields || {}));
 const bounded = (fields, keys, max, scale=1) => {
   for (const key of keys) {
     const n = Number(fields?.[key] ?? 0);
     if (!Number.isFinite(n) || n < 0 || n > max || Math.abs(n * scale - Math.round(n * scale)) > 1e-7) {
       throw Error('Invalid quantity or amount.');
     }
   }
 };
 const validate = fields => {
   if (!fields || typeof fields !== 'object' || Array.isArray(fields) ||
       Object.values(fields).some(value => typeof value !== 'string' || value.length > 200)) {
     throw Error('Invalid form fields.');
   }
   bounded(fields,['boxes','units','freeBoxes','freeUnits'],100000);
   bounded(fields,['carton','loose','cost','paid','amount','credit'],1000000,100);
   bounded(fields,['tax'],100,100);
   if (fields.pack !== undefined) {
     bounded(fields,['pack'],10000);
     if (Number(fields.pack)<1) throw Error('Enter units per carton.');
   }
   if (fields.method && !['Cash','UPI','Bank'].includes(fields.method)) throw Error('Invalid payment method.');
 };
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const product = (state,id) => state.products.find(p=>p.id===id);
const fstr=(f,k)=>String(f.get(k)||'').trim();
const num=(f,k)=>Number(f.get(k)||0);
const paise=(f,k)=>Math.round(num(f,k)*100);
function makeProduct(f){
 const name=fstr(f,'name');
 if(!name)throw Error('Enter a product name.');
 return {id:crypto.randomUUID(),name,barcode:fstr(f,'barcode'),pack:num(f,'pack'),carton:paise(f,'carton'),loose:paise(f,'loose'),hsn:fstr(f,'hsn'),tax:num(f,'tax'),stock:0,cost:0};
}
function addProduct(s,p){
 const clean = name=>name.toLowerCase().replace(/\s+/g,' ');
 if(s.products.some(x=>clean(x.name)===clean(p.name)||(p.barcode&&x.barcode===p.barcode)))throw Error('This product name or barcode already exists. Select the existing product.');
 s.products.push(p);
}
const quantity=(f,p)=>num(f,'boxes')*p.pack+num(f,'units');
const entry=(s,type,fields)=>s.entries.push({id:s.next++,date:today(),type,actor,...fields});
const byParty = value=>value.trim().toLowerCase().replace(/\s+/g,' ');
function balances(){
 const parties=new Map();
 for(const e of data.entries){
   if(!e.side)continue;
   const k=e.side+':'+byParty(e.party);
   if(!parties.has(k))parties.set(k,{side:e.side,party:e.party,balance:0});
   parties.get(k).balance+=e.due;
 }
 return [...parties.values()];
}
function addLine(f){
 const purchase=page==='Purchase', id=fstr(f,'product');
 const existing=product(data,id)||lines.find(l=>l.newProduct?.id===id)?.newProduct;
 const fresh=id==='new'?makeProduct(f):null;
 const p=fresh||existing;
 if(!p)throw Error('Select a product.');
 if(fresh)addProduct({products:[...data.products,...lines.flatMap(l=>l.newProduct?[l.newProduct]:[])]},fresh);
 const free=purchase?num(f,'freeBoxes')*p.pack+num(f,'freeUnits'):0;
 const count=quantity(f,p)+free;
 if(count<1)throw Error('Enter at least one unit.');
 const base=purchase?paise(f,'cost'):num(f,'boxes')*p.carton+num(f,'units')*p.loose;
 lines.push({id:p.id,name:p.name,hsn:p.hsn,boxes:num(f,'boxes'),units:num(f,'units'),quantity:count,base,tax:Math.round(base*p.tax/100),newProduct:fresh});
}
function post(f){
 const purchase=page==='Purchase';
 const total=lines.reduce((sum,l)=>sum+l.base+l.tax,0);
 const paid=paise(f,'paid'),party=fstr(f,'party');
 if(!party||paid>total||!lines.length)throw Error('Enter a party and a payment no greater than the bill total.');
 save(s=>{
   for(const l of lines){
     if(l.newProduct)addProduct(s,l.newProduct);
     const p=product(s,l.id);
     if(purchase){
       p.cost=(p.stock*p.cost+l.base)/(p.stock+l.quantity);
       p.stock+=l.quantity;
     }else{
       if(l.quantity>p.stock)throw Error('Insufficient stock for '+p.name+'.');
       p.stock-=l.quantity;
     }
   }
   entry(s,page,{party,side:purchase?'Supplier':'Customer',total,due:total-paid,flow:purchase?-paid:paid,method:fstr(f,'method'),lines:lines.map(({newProduct,...line})=>line),shop:s.shop});
 });
 
 lines=[];
}
function payment(f){
 const kind=fstr(f,'kind'),party=fstr(f,'party'),amount=paise(f,'amount');
 if(!party||amount<=0)throw Error('Enter a party or description and a positive amount.');
 const expense=kind==='expense',opening=kind.startsWith('opening');
 const side=expense?null:['collection','openingCustomer'].includes(kind)?'Customer':'Supplier';
 const balance=balances().find(b=>b.side===side&&byParty(b.party)===byParty(party))?.balance||0;
 if(!opening&&!expense&&amount>balance)throw Error('Payment exceeds the outstanding balance for this party.');
 const names={collection:'Collection',supplier:'Supplier payment',expense:'Expense',openingCustomer:'Opening customer dues',openingSupplier:'Opening supplier dues'};
 save(s=>entry(s,names[kind],{party,side,total:amount,due:expense?0:opening?amount:-amount,flow:opening?0:kind==='collection'?amount:-amount,method:fstr(f,'method')}));
}
function adjust(f){
 const kind=fstr(f,'kind'),party=fstr(f,'party'),credit=paise(f,'credit');
 const p=product(data,fstr(f,'product'));
 if(!p||!party||quantity(f,p)<1)throw Error('Select a product and enter a quantity and party or reason.');
 const side=kind==='supplier'?'Supplier':['sellable','unsellable'].includes(kind)?'Customer':null;
 const balance=balances().find(b=>b.side===side&&byParty(b.party)===byParty(party))?.balance||0;
 if(credit&&(!side||credit>balance))throw Error('Credit must be within this party’s outstanding balance.');
 const movement=quantity(f,p)*(kind==='sellable'?1:kind==='unsellable'?0:-1);
 if(p.stock+movement<0)throw Error('Adjustment exceeds stock on hand.');
 const names={sellable:'Sellable customer return',unsellable:'Unsellable customer return',supplier:'Supplier return',damage:'Damage',expiry:'Expiry'};
 save(s=>{product(s,p.id).stock+=movement;entry(s,names[kind],{party,side,total:credit,due:-credit,lines:[{name:p.name,quantity:movement}]})});
}

 const fields = command.fields;
 validate(fields);
 const f = form(fields);
 switch (command.action) {
   case 'product': {
     if (fields.pack === undefined) throw Error('Enter units per carton.');
     const p = makeProduct(f);
     p.stock = quantity(f,p);
     p.cost = paise(f,'cost');
     addProduct(data,p);
     break;
   }
   case 'post':
     if (!['Sale','Purchase'].includes(page) || !Array.isArray(command.lines) || command.lines.length < 1 || command.lines.length > 50) throw Error('Invalid bill.');
     for (const line of command.lines) {
       validate(line);
       if (line.product === 'new' && (page !== 'Purchase' || line.pack === undefined)) throw Error('Invalid new product.');
       addLine(form(line));
     }
     post(f);
     break;
   case 'payment':
     if (!['collection','supplier','expense','openingCustomer','openingSupplier'].includes(fields.kind)) throw Error('Invalid payment type.');
     payment(f);
     break;
   case 'return':
     if (!['sellable','unsellable','supplier','damage','expiry'].includes(fields.kind)) throw Error('Invalid adjustment type.');
     adjust(f);
     break;
   case 'shop':
     if (!fstr(f,'name')) throw Error('Enter a business name.');
     data.shop={name:fstr(f,'name'),gstin:fstr(f,'gstin').toUpperCase(),address:fstr(f,'address')};
     break;
   default: throw Error('Unknown action.');
 }
 return data;
}
