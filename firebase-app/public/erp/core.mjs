export const collections = ['items','parties','orders','documents','movements','visits','closings','settings'];
export const empty = () => Object.fromEntries(collections.map(name => [name, []]));
export const cash = value => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1e9) throw Error('Enter a valid amount.');
  return Math.round(number * 100);
};
export const text = (value, name) => {
  const result = String(value ?? '').trim();
  if (!result || result.length > 200) throw Error('Enter '+name+'.');
  return result;
};
const integer = (value, name, min = 0) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > 1e9) throw Error('Check '+name+'.');
  return n;
};
const find = (state, kind, id) => {
  const row = state[kind].find(item => item.id === id);
  if (!row) throw Error('Record not found. Refresh and try again.');
  return row;
};
const normalize = value => value.trim().toLowerCase().replace(/\s+/g,' ');
export function unitList(item) {
  return [{name:item.unit, factor:1, price:item.price}, ...item.packs.map(pack => ({name:pack.name,factor:pack.factor,price:pack.price}))];
}
export function stockLabel(item) {
  let quantity = item.stock;
  const parts = [];
  for (const unit of unitList(item).reverse()) {
    const count = Math.floor(quantity / unit.factor);
    if (count) parts.push(count+' '+unit.name);
    quantity %= unit.factor;
  }
  return parts.join(' + ') || '0 '+item.unit;
}
export function outstanding(state, partyId) {
  return state.documents.filter(doc=>doc.partyId===partyId).reduce((sum,doc)=>sum+(doc.dueDelta||0),0);
}
export function billBalance(state, id) {
  const bill = find(state,'documents',id);
  const allocated = state.documents.flatMap(doc=>doc.allocations||[]).filter(row=>row.billId===id).reduce((sum,row)=>sum+row.amount,0);
  return bill.total-allocated;
}
export function openBills(state, partyId) {
  return state.documents.filter(doc=>doc.partyId===partyId&&['sale','purchase','openingDue'].includes(doc.type))
    .map(doc=>({...doc,balance:billBalance(state,doc.id)})).filter(doc=>doc.balance>0)
    .sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||'').localeCompare(b.createdAt||'')||a.id.localeCompare(b.id));
}
export function dayReport(state, date) {
  const docs = state.documents.filter(doc=>doc.date===date);
  const sum = (type,key) => docs.filter(doc=>doc.type===type).reduce((n,doc)=>n+(doc[key]||0),0);
  const methods = ['Cash','UPI','Bank','Card'].map(method=>{
    const rows=docs.filter(doc=>doc.method===method);
    return {method,received:rows.reduce((n,doc)=>n+Math.max(0,doc.moneyDelta||0),0),paid:rows.reduce((n,doc)=>n+Math.max(0,-doc.moneyDelta||0),0)};
  });
  return {sales:sum('sale','total'),purchases:sum('purchase','total'),expenses:sum('expense','total'),
    customerReturns:sum('customerReturn','total'),supplierReturns:sum('supplierReturn','total'),methods};
}
export function orderRemaining(order) {
  return order.lines.map(line=>({...line,remaining:line.baseQuantity-line.sent}));
}
export function apply(state, command, context) {
  const next=structuredClone(state), writes=[];
  const {id,date,actor}=context;
  const createdAt=context.createdAt||new Date().toISOString();
  const moneyOperations=['openingStock','openingDue','purchase','sale','dispatch','receipt','payment','customerReturn','supplierReturn','expense'];
  if(moneyOperations.includes(command.type)&&next.closings.some(row=>row.date===date))throw Error('This day is closed. Use an open business date.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))throw Error('Enter a valid business date.');
  const body=command.body;
  const put=(kind,row)=>{
    next[kind]=next[kind].filter(old=>old.id!==row.id).concat(row);
    const index=writes.findIndex(write=>write.kind===kind&&write.row.id===row.id);
    const write={kind,row};
    if(index>=0)writes[index]=write;else writes.push(write);
    return row;
  };
  const partySnapshot=party=>({partyId:party.id,partyName:party.name,address:party.address,area:party.area||'',gstin:party.gstin||''});
  const document=(type,fields,suffix='')=>{
    const sequence=next.documents.filter(doc=>doc.type===type).length+1;
    const code=type.toUpperCase().slice(0,3)+'/'+date.slice(0,4)+'/'+String(sequence).padStart(6,'0');
    return put('documents',{id:id+suffix,type,date,actor,createdAt,code,...fields});
  };
  const method=value=>{
    if(!['Cash','UPI','Bank','Card'].includes(value))throw Error('Select a payment method.');
    return value;
  };
  const allocate=(partyId,amount,chosen)=>{
    let remaining=amount;
    const bills=openBills(next,partyId).filter(bill=>!chosen||bill.id===chosen);
    const allocations=[];
    for(const bill of bills){
      const used=Math.min(remaining,bill.balance);
      if(used)allocations.push({billId:bill.id,amount:used});
      remaining-=used;
    }
    if(remaining)throw Error('Amount exceeds the selected outstanding bills.');
    return allocations;
  };
  const move=(item,quantity,source,cost,movementKey=item.id)=>{
    const stock=item.stock+quantity;
    if(stock<0)throw Error('Insufficient stock for '+item.name+'.');
    put('items',{...item,stock});
    put('movements',{id:source+'-'+movementKey,itemId:item.id,itemName:item.name,date,actor,quantity,cost,source});
  };
  const makeLines=(rows,mode)=>{
    if(!Array.isArray(rows)||!rows.length||rows.length>50)throw Error('Add between 1 and 50 item rows.');
    const lines=rows.map((row,index)=>{
      const item=find(next,'items',row.itemId);
      const unit=unitList(item).find(unit=>unit.name===row.unit);
      if(!unit)throw Error('Select a unit for '+item.name+'.');
      const quantity=integer(row.quantity,'quantity',1),free=mode==='purchase'?integer(row.free||0,'free quantity'):0;
      const baseQuantity=(quantity+free)*unit.factor;
      integer(baseQuantity,'total quantity',1);
      const rate=integer(row.rate,'rate'),discount=Number(row.discount||0);
      if(!Number.isFinite(discount)||discount<0||discount>100)throw Error('Discount must be 0 to 100%.');
      const base=Math.round(quantity*rate*(1-discount/100)),tax=Math.round(base*item.tax/100);
      return {id:String(index),itemId:item.id,name:item.name,unit:unit.name,factor:unit.factor,quantity,free,baseQuantity,
        rate,discount,hsn:item.hsn,taxRate:item.tax,base,tax,total:base+tax,cost:Math.round(baseQuantity*item.cost)};
    });
    return lines;
  };
  const postBill=(type,party,lines,fields={},paid=0,paymentMethod='Cash')=>{
    const total=lines.reduce((sum,line)=>sum+line.total,0);
    if(paid>total)throw Error('Payment exceeds the bill.');
    for(const line of lines){
      const item=find(next,'items',line.itemId);
      if(type==='purchase'){
        const newCost=(item.stock*item.cost+line.base)/(item.stock+line.baseQuantity);
        move({...item,cost:newCost},line.baseQuantity,id,line.base,line.id+'-'+item.id);
      }else move(item,-line.baseQuantity,id,-line.cost,line.id+'-'+item.id);
    }
    const bill=document(type,{...partySnapshot(party),...fields,lines,total,dueDelta:total,
      shop:structuredClone(next.settings.find(row=>row.id==='shop')||{name:'Dheeraj Wholesale',address:'',gstin:''})});
    if(paid){
      document(type==='sale'?'receipt':'payment',{...partySnapshot(party),total:paid,dueDelta:-paid,
        moneyDelta:type==='sale'?paid:-paid,method:method(paymentMethod),allocations:[{billId:id,amount:paid}]},'-paid');
    }
    return bill;
  };
  switch(command.type){
    case 'item': {
      const itemId=body.id||id,old=next.items.find(row=>row.id===itemId);
      const name=text(body.name,'item name'),unit=text(body.unit,'stock unit');
      if(next.items.some(row=>row.id!==itemId&&(normalize(row.name)===normalize(name)||(body.barcode&&row.barcode===body.barcode))))throw Error('This name or barcode already exists.');
      const packs=[],names=new Set([normalize(unit)]);
      let factor=1;
      if(!Array.isArray(body.packs)||body.packs.length>5)throw Error('Check the packing rows.');
      for(const pack of body.packs){
        const label=text(pack.name,'pack name');
        if(names.has(normalize(label)))throw Error('Use a different name for each pack.');
        names.add(normalize(label));
        const contains=integer(pack.contains,'pack size',2);
        factor*=contains;integer(factor,'packing conversion',1);
        packs.push({name:label,contains,factor,price:integer(pack.price,'pack selling price')});
      }
      if(old&&(old.stock||next.movements.some(row=>row.itemId===itemId))&&JSON.stringify(old.packs.map(p=>[p.name,p.factor]))!==JSON.stringify(packs.map(p=>[p.name,p.factor])))throw Error('This item has stock history. Create a new item for changed packing.');
      if(old&&next.movements.some(row=>row.itemId===itemId)&&old.unit!==unit)throw Error('Stock unit cannot change after stock movements.');
      const tax=Number(body.tax);
      if(!Number.isFinite(tax)||tax<0||tax>100)throw Error('Check GST %.');
      put('items',{id:itemId,name,unit,packs,mrp:integer(body.mrp,'MRP'),price:integer(body.price,'selling price'),
        hsn:String(body.hsn||'').trim(),tax,barcode:String(body.barcode||'').trim(),stock:old?.stock||0,cost:old?.cost||0});
      break;
    }
    case 'party': {
      if(!['Customer','Supplier'].includes(body.role))throw Error('Select customer or supplier.');
      const partyId=body.id||id,previous=next.parties.find(row=>row.id===partyId);
      if(previous&&previous.role!==body.role)throw Error('Create another profile for a different party role.');
      const enteredArea=body.role==='Customer'?text(body.area,'area').replace(/\s+/g,' '):'';
      const area=next.parties.find(row=>row.area&&normalize(row.area)===normalize(enteredArea))?.area||enteredArea;
      put('parties',{id:partyId,role:body.role,name:text(body.name,'party name'),address:text(body.address,'address'),
        area,
        mobile:String(body.mobile||''),gstin:String(body.gstin||''),prices:previous?.prices||[]});
      break;
    }
    case 'price': {
      const party=find(next,'parties',body.partyId),item=find(next,'items',body.itemId);
      if(party.role!=='Customer'||!unitList(item).some(row=>row.name===body.unit))throw Error('Check customer and unit.');
      const prices=party.prices.filter(row=>row.itemId!==item.id||row.unit!==body.unit);
      prices.push({itemId:item.id,unit:body.unit,rate:integer(body.rate,'selling price')});
      put('parties',{...party,prices});break;
    }
    case 'openingStock': {
      const item=find(next,'items',body.itemId),unit=unitList(item).find(row=>row.name===body.unit);
      if(!unit)throw Error('Select a unit.');
      const quantity=integer(body.quantity,'quantity',1)*unit.factor,cost=integer(body.cost,'cost per selected unit');
      const value=Math.round(integer(body.quantity,'quantity')*cost);
      move({...item,cost:(item.stock*item.cost+value)/(item.stock+quantity)},quantity,id,value);
      document('openingStock',{partyName:'Opening stock',itemId:item.id,total:value,dueDelta:0,lines:[{name:item.name,quantity,unit:item.unit}]});
      break;
    }
    case 'openingDue': {
      const party=find(next,'parties',body.partyId),amount=integer(body.amount,'opening balance',1);
      document('openingDue',{...partySnapshot(party),total:amount,dueDelta:amount});break;
    }
    case 'purchase':
    case 'sale': {
      const party=find(next,'parties',body.partyId);
      if(party.role!==(command.type==='sale'?'Customer':'Supplier'))throw Error('Select the correct party type.');
      const reference=command.type==='purchase'?text(body.reference,'supplier invoice number'):'';
      if(reference&&next.documents.some(row=>row.type==='purchase'&&row.partyId===party.id&&row.reference===reference))throw Error('This supplier invoice is already saved.');
      postBill(command.type,party,makeLines(body.lines,command.type),{reference},integer(body.paid||0,'paid amount'),body.method);
      break;
    }
    case 'order': {
      const party=find(next,'parties',body.partyId);
      if(party.role!=='Customer')throw Error('Select a customer.');
      const lines=makeLines(body.lines,'order').map(line=>({...line,sent:0}));
      put('orders',{id,date,actor,...partySnapshot(party),lines});break;
    }
    case 'dispatch': {
      const order=find(next,'orders',body.orderId),party=find(next,'parties',order.partyId);
      const rows=body.lines;
      if(!Array.isArray(rows)||!rows.length)throw Error('Enter dispatch quantities.');
      const lines=rows.map(row=>{
        const ordered=order.lines.find(line=>line.id===row.lineId);
        if(!ordered)throw Error('Order line missing.');
        const item=find(next,'items',ordered.itemId);
        const chosenUnit=unitList(item).find(unit=>unit.name===(row.unit||ordered.unit));
        if(!chosenUnit)throw Error('Select a dispatch unit.');
        const quantity=integer(row.quantity,'dispatch quantity',1),baseQuantity=quantity*chosenUnit.factor;
        if(baseQuantity>ordered.baseQuantity-ordered.sent)throw Error('Dispatch exceeds the remaining order.');
        const rate=row.rate===undefined?Math.round(ordered.rate*chosenUnit.factor/ordered.factor):integer(row.rate,'dispatch rate');
        const base=Math.round(quantity*rate*(1-ordered.discount/100)),tax=Math.round(base*ordered.taxRate/100);
        return {...ordered,unit:chosenUnit.name,factor:chosenUnit.factor,rate,quantity,baseQuantity,free:0,base,tax,total:base+tax,cost:Math.round(baseQuantity*find(next,'items',ordered.itemId).cost)};
      });
      if(new Set(lines.map(line=>line.id)).size!==lines.length)throw Error('Duplicate dispatch line.');
      const bill=postBill('sale',party,lines,{orderId:order.id,partyName:order.partyName,address:order.address,area:order.area,delivery:'Out for delivery'},integer(body.paid||0,'amount received'),body.method);
      put('orders',{...order,lines:order.lines.map(line=>({...line,sent:line.sent+(lines.find(row=>row.id===line.id)?.baseQuantity||0)}))});
      return {state:next,writes,result:bill.id};
    }
    case 'delivered': {
      const bill=find(next,'documents',body.id);
      if(!bill.orderId||bill.delivery==='Delivered')throw Error('This delivery is already closed or unavailable.');
      put('documents',{...bill,delivery:'Delivered',deliveredDate:date});break;
    }
    case 'receipt':
    case 'payment': {
      const party=find(next,'parties',body.partyId),amount=integer(body.amount,'amount',1);
      if(party.role!==(command.type==='receipt'?'Customer':'Supplier'))throw Error('Check party type.');
      const allocations=allocate(party.id,amount,body.billId);
      document(command.type,{...partySnapshot(party),total:amount,dueDelta:-amount,moneyDelta:command.type==='receipt'?amount:-amount,
        method:method(body.method),allocations});break;
    }
    case 'customerReturn':
    case 'supplierReturn': {
      const source=find(next,'documents',body.sourceId),customer=command.type==='customerReturn';
      if(source.type!==(customer?'sale':'purchase'))throw Error('Select the original bill.');
      const line=source.lines.find(line=>line.id===body.lineId);
      if(!line)throw Error('Select a bill item.');
      const quantity=integer(body.quantity,'return quantity',1);
      const returned=next.documents.filter(doc=>doc.type===command.type&&doc.sourceId===source.id&&doc.sourceLineId===line.id).reduce((n,doc)=>n+doc.quantity,0);
      if(quantity+returned>line.quantity+line.free)throw Error('Return exceeds the source quantity.');
      const baseQuantity=quantity*line.factor,item=find(next,'items',line.itemId);
      if(customer&&!['Sellable','Unsellable'].includes(body.condition))throw Error('Select the return condition.');
      if(!customer||body.condition==='Sellable')move(item,customer?baseQuantity:-baseQuantity,id,customer?Math.round(baseQuantity*item.cost):-Math.round(baseQuantity*item.cost));
      const value=integer(body.amount,'return value',1),party=find(next,'parties',source.partyId);
      let dueDelta=0,allocations=[],moneyDelta=0;
      if(body.settlement==='Credit'){
        allocations=allocate(party.id,value);dueDelta=-value;
      }else if(body.settlement==='Refund')moneyDelta=customer?-value:value;
      else throw Error('Choose Credit or Refund.');
      document(command.type,{...partySnapshot(party),sourceId:source.id,sourceLineId:line.id,quantity,total:value,dueDelta,
        moneyDelta,allocations,method:moneyDelta?method(body.method):'',condition:customer?body.condition:'Supplier return',
        lines:[{...line,quantity,baseQuantity}]});break;
    }
    case 'expense': {
      const amount=integer(body.amount,'expense amount',1);
      document('expense',{partyName:text(body.description,'expense description'),category:text(body.category,'expense category'),
        area:String(body.area||''),total:amount,dueDelta:0,moneyDelta:-amount,method:method(body.method)});break;
    }
    case 'closing': {
      if(next.closings.some(row=>row.date===date))throw Error('This date is already closed. Review its saved report.');
      const report=dayReport(next,date),opening=integer(body.opening,'opening cash'),counted=integer(body.counted,'counted cash');
      const cashFlow=report.methods.find(row=>row.method==='Cash');
      put('closings',{id,date,actor,report,opening,counted,expected:opening+cashFlow.received-cashFlow.paid,
        difference:counted-(opening+cashFlow.received-cashFlow.paid),note:String(body.note||'')});break;
    }
    case 'visit': {
      put('visits',{id,date,actor,area:text(body.area,'area'),note:text(body.note,'visit tasks'),done:false});break;
    }
    case 'visitDone': {
      put('visits',{...find(next,'visits',body.id),done:true});break;
    }
    case 'settings': {
      put('settings',{id:'shop',name:text(body.name,'shop name'),address:text(body.address,'shop address'),
        gstin:String(body.gstin||''),phone:String(body.phone||''),logo:body.logo||'',signature:body.signature||''});break;
    }
    default: throw Error('Unknown operation.');
  }
  return {state:next,writes,result:id};
}
