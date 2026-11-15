import {applyCommand} from './domain.mjs';

const shortText = (value, label) => {
  const result = String(value ?? '').trim();
  if (!result || result.length > 120) throw Error('Enter a valid '+label+'.');
  return result;
};

const whole = (value, label) => {
  const number = Number(value || 0);
  if (!Number.isInteger(number) || number < 0 || number > 100000) {
    throw Error(label+' must be a whole number from 0 to 100,000.');
  }
  return number;
};

export const areaKey = value => value.trim().toLowerCase().replace(/\s+/g,' ');

export function orderAvailability(order, products) {
  return order.lines.map(line => {
    const stock = products.find(item => item.id === line.product)?.stock ?? 0;
    const pending = line.ordered - line.sent;
    return {...line, pending, available: Math.min(stock, pending)};
  });
}

export function applyOrder(state, actor, command, id, date) {
  const {action, fields} = command;
  if (action === 'customer') {
    const profile = {id, name:shortText(fields.name,'customer name'),
      area:shortText(fields.area,'area').replace(/\s+/g,' '),
      address:shortText(fields.address,'delivery address')};
    const similar = state.customers.find(row => row.id !== id && areaKey(row.area) === areaKey(profile.area));
    if(similar)profile.area=similar.area;
    const index=state.customers.findIndex(row=>row.id===id);
    if(index<0)state.customers.push(profile);
    else state.customers[index]=profile;
    return;
  }
  if (action === 'order') {
    const lines = [];
    for (const [index, item] of state.products.entries()) {
      const cartons = whole(fields['cartons'+index], 'Cartons');
      const loose = whole(fields['loose'+index], 'Loose units');
      if (!cartons && !loose) continue;
      const cartonRate = Number(fields['rateCarton'+index] || 0);
      const looseRate = Number(fields['rateLoose'+index] || 0);
      if ([cartonRate, looseRate].some(rate => !Number.isFinite(rate) || rate < 0 || rate > 1000000)) {
        throw Error('Enter valid selling rates.');
      }
      lines.push({product:item.id, name:item.name, pack:item.pack, ordered:cartons*item.pack+loose,
        sent:0, cartonRate:Math.round(cartonRate*100), looseRate:Math.round(looseRate*100)});
    }
    if (!lines.length || lines.length > 12) throw Error('Add quantities for one to twelve products.');
    const customer=state.customers.find(row=>row.id===fields.customer);
    if(!customer)throw Error('Select a customer profile.');
    state.orders.push({id,customerId:customer.id,party:customer.name,area:customer.area,
      address:customer.address,date,lines,dispatches:[]});
    return;
  }
  const order = state.orders.find(row => row.id === fields.order);
  if (!order) throw Error('This order is no longer available.');
  if (action === 'delivered') {
    const dispatch = order.dispatches.find(row => String(row.entryId) === fields.entry);
    if (!dispatch || dispatch.delivered) throw Error('This dispatch is already closed.');
    dispatch.delivered = true;
    dispatch.deliveryDate = date;
    return;
  }
  const dispatchLines = [];
  const quantities = [];
  for (const [index, line] of orderAvailability(order,state.products).entries()) {
    const boxes = whole(fields['cartons'+index],'Cartons');
    const units = whole(fields['loose'+index],'Loose units');
    const count = boxes*line.pack+units;
    if (!count) continue;
    if (count > line.available) throw Error('Check available and pending stock for '+line.name+'.');
    const item = state.products.find(row=>row.id===line.product);
    if (item.pack !== line.pack) throw Error('Carton size changed for '+line.name+'. Review the order.');
    dispatchLines.push({product:line.product,boxes:String(boxes),units:String(units),
      cartonRate:String(line.cartonRate),looseRate:String(line.looseRate)});
    quantities.push({product:line.product,name:line.name,quantity:count});
  }
  const entryId=state.next;
  applyCommand(state,actor,{action:'post',page:'Sale',lines:dispatchLines,
    fields:{party:order.party,paid:fields.paid,method:fields.method}});
  Object.assign(state.entries.at(-1),{orderId:order.id,area:order.area,...(order.customerId?{customerId:order.customerId,address:order.address}:{})});
  for(const quantity of quantities){
    order.lines.find(line=>line.product===quantity.product).sent+=quantity.quantity;
  }
  order.dispatches.push({entryId,date,delivered:false,lines:quantities});
}
