const test = require('node:test');
const assert = require('node:assert/strict');
const {simulate} = require('./mev.js');
const setup = {amount:5000,buy:2500,sell:2600,premium:5,gas:8};
test('spread repays premium, subsequent order gets a worse quote', () => {
  const first = simulate(setup), second = simulate(setup,true);
  assert.ok(first.net > 0 && !first.reverted);
  assert.equal(first.due,5002.5);
  assert.ok(second.net < first.net && second.weth < first.weth);
});
test('insufficient repayment reverts swaps and still costs gas', () => {
  const flat = simulate({...setup,sell:2500});
  assert.equal(flat.reverted,true);
  assert.equal(flat.net,-8);
});
test('repayable routes can lose money after gas', () => {
  const expensive = simulate({...setup,gas:200});
  assert.equal(expensive.reverted,false);
  assert.ok(expensive.net < 0);
});
