const test = require('ava');
const utils = require("./utils");

test('test signing and signature verification', t => {
  const signingKey = 'a-super-secret-key';
  const signingKeyAlgorithm = 'sha256';
  const data = {"foo": "bar"};
  const signature = utils.signData(data, signingKey, signingKeyAlgorithm);
  t.truthy(utils.isValidSignature(signature, data, signingKey, signingKeyAlgorithm));
});
