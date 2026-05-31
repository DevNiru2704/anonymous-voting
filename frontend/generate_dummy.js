const { StrKey } = require('@stellar/stellar-sdk');
const crypto = require('crypto');

// Generate 32 random bytes
const randomBytes = crypto.randomBytes(32);

// Encode as Contract ID
const contractId = StrKey.encodeContract(randomBytes);
console.log(contractId);
