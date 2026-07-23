const assert = require('assert/strict');
const { validateIpv4Cidr, normalizeIpv4Cidr } = require('../src/utils/ipCidr');

const validValues = [
  '192.168.1.1',
  '170.81.36.0/22',
  '10.0.0.0/8',
  '0.0.0.0/0',
  '255.255.255.255/32'
];

const invalidValues = [
  '',
  '999.999.999.999',
  '192.168.1',
  '192.168.1.1/33',
  '192.168.1.1/-1',
  '192.168.1.1/',
  '192..168.1.1',
  '192.168.1.1.1',
  'abc',
  'example.com',
  '10.0.0.1/teste',
  '10.0.0.1/01',
  '192.168.001.001',
  '2001:db8::1'
];

validValues.forEach((value) => {
  assert.equal(validateIpv4Cidr(value), true, `${value} should be valid`);
  assert.equal(normalizeIpv4Cidr(` ${value} `), value);
});
invalidValues.forEach((value) => {
  assert.equal(validateIpv4Cidr(value), false, `${value || '(empty)'} should be invalid`);
  assert.equal(normalizeIpv4Cidr(value), null);
});

console.log(JSON.stringify({
  ok: true,
  valid_cases: validValues.length,
  invalid_cases: invalidValues.length,
  ipv6: 'rejected'
}, null, 2));
